import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda'
import { CloudFormation, SSM, CodeBuild, SecretsManager, CodePipeline } from 'aws-sdk'
import {
  CodePipelineClient,
  CreatePipelineCommand,
  ListPipelinesCommand,
  CreatePipelineCommandInput,
} from '@aws-sdk/client-codepipeline'
import { CreateProjectInput } from 'aws-sdk/clients/codebuild'
const {
  AWS_REGION,
  AWS_GITHUB_TRIGGER_STACK_NAME,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY,
  AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY,
  OWNER_NAME,
  REPOSITORY_NAME,
  GITHUB_CONNECTION_ARN_SSM_KEY,
} = process.env

const codePipelineClient = new CodePipelineClient({ region: AWS_REGION })
const cloudformation = new CloudFormation()
const ssm = new SSM()
const codebuild = new CodeBuild()
const secretsManager = new SecretsManager()
const codepipeline = new CodePipeline()

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    let body = JSON.parse(event.body ?? '{}')

    let branchName: string = body.ref.split('/').pop()
    console.log('Branch Name:', branchName)

    // Pipelineリソースを作成
    await createPipeline(branchName)

    return {
      statusCode: 200,
      body: JSON.stringify(`Create AWS Resource for ${branchName}`),
    }
  } catch (e) {
    console.error(e)

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'internal server error.' }),
    }
  }
}

// TODO すでにPipelineが存在していたら削除して作り直してるけど、トランザクションは大丈夫？削除だけ成功してPipeline構築が失敗するケースとか
const createPipeline = async (branchName: string, overwriting: boolean = true): Promise<void> => {
  console.log(`start ${createPipeline.name}:${branchName}`)

  try {
    // 同じPipelineがすでに存在するなら削除して作り直したい
    const listPipelinesOutput = await codePipelineClient.send(new ListPipelinesCommand({}))
    const existPipeline = listPipelinesOutput.pipelines?.find((pipeline) => pipeline.name === `pipeline-${branchName}`)
    if (existPipeline) {
      if (overwriting) {
        console.log(`Delete Pipeline ${existPipeline.name} to update new version`)
        await codepipeline.deletePipeline({ name: existPipeline.name ?? '' }).promise()
      } else {
        throw new Error(`Pipeline ${existPipeline.name} already exists.`)
      }
    }

    // pipelineリソースを構築するための必要なロールやS3バケットキーを取得
    const [roleArn, artifactBucketName, connectionArn, sourceCodeBucketName] = await Promise.all([
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY ?? ''),
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY ?? ''),
      getValueFromParameterStore(GITHUB_CONNECTION_ARN_SSM_KEY ?? ''),
      getValueFromStackOutputByKey(AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY ?? ''),
    ])

    // codebuildプロジェクトを作成
    const codebuildProjectName = await createCodeBuildProject(branchName)

    const pipelineName = `pipeline-${branchName}`
    const params: CreatePipelineCommandInput = {
      pipeline: {
        name: pipelineName,
        roleArn: roleArn,
        artifactStore: {
          location: artifactBucketName,
          type: 'S3',
        },
        stages: [
          {
            name: 'Source',
            actions: [
              {
                name: 'SourceAction',
                actionTypeId: {
                  category: 'Source',
                  owner: 'AWS',
                  version: '1',
                  // GitHub との接続を管理するためのAWSのサービス
                  provider: 'CodeStarSourceConnection',
                },
                configuration: {
                  // Githubと接続する通信を識別するARN
                  ConnectionArn: connectionArn,
                  FullRepositoryId: `${OWNER_NAME}/${REPOSITORY_NAME}`,
                  BranchName: branchName,
                },
                // ブランチごとに識別させなくて大丈夫？
                outputArtifacts: [{ name: 'SourceOutput' }],
              },
            ],
          },
          {
            name: 'Build',
            actions: [
              {
                name: 'BuildAction',
                actionTypeId: {
                  category: 'Build',
                  owner: 'AWS',
                  version: '1',
                  provider: 'CodeBuild',
                },
                configuration: {
                  ProjectName: codebuildProjectName,
                },
                inputArtifacts: [{ name: 'SourceOutput' }],
                outputArtifacts: [{ name: 'BuildOutput' }],
              },
            ],
          },
          {
            name: 'Deploy',
            actions: [
              {
                name: 'DeployAction',
                actionTypeId: {
                  category: 'Deploy',
                  owner: 'AWS',
                  version: '1',
                  provider: 'S3',
                },
                configuration: {
                  BucketName: sourceCodeBucketName,
                  ObjectKey: branchName,
                  Extract: 'true', // 元ファイルであるアーティファクトがzipになっていた場合は自動で展開してくれる
                },
                inputArtifacts: [{ name: 'BuildOutput' }],
              },
            ],
          },
        ],
      },
    }

    await codePipelineClient.send(new CreatePipelineCommand(params))
    console.log(`Created pipeline: ${pipelineName}`)
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${createPipeline.name}`)
  }
}

const createCodeBuildProject = async (branchName: string, overwriting = true): Promise<string> => {
  console.log(`start ${createCodeBuildProject.name}:${branchName}`)

  const projectName = `CodeBuild-${branchName}`

  try {
    const existCodeBuildProject = await codebuild.batchGetProjects({ names: [projectName] }).promise()
    if (existCodeBuildProject.projects && existCodeBuildProject.projects?.length > 0) {
      if (overwriting) {
        console.log(`Delete CodeBuild Project ${projectName} to update new version`)
        await codebuild.deleteProject({ name: projectName }).promise()
      } else {
        throw new Error('codebuild project already exists')
      }
    }

    // codebuildプロジェクトを構築するための必要なロールを取得
    const [roleArn] = await Promise.all([
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY ?? ''),
    ])

    const params: CreateProjectInput = {
      name: projectName,
      description: `Build project for branch : ${branchName}`,
      source: {
        type: 'CODEPIPELINE', // コードパイプラインのステージ間でソースコードを受け取る前提
      },
      artifacts: {
        type: 'CODEPIPELINE', // コードパイプラインのステージ間でアーティファクトを受け取る前提
      },
      environment: {
        type: 'LINUX_CONTAINER',
        computeType: 'BUILD_GENERAL1_SMALL',
        image: 'aws/codebuild/standard:5.0',
      },
      serviceRole: roleArn,
    }

    await codebuild.createProject(params).promise()
    console.log(`Created codebuild project: ${branchName}`)

    return projectName
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${createCodeBuildProject.name}`)
  }
}

const getValueFromParameterStore = async (key: string): Promise<string> => {
  console.log(`start ${getValueFromParameterStore.name} key: ${key}`)

  try {
    const res = await ssm.getParameter({ Name: key, WithDecryption: true }).promise()
    console.log(`value : ${res.Parameter?.Value}`)

    const value = res.Parameter?.Value
    if (!value) {
      throw new Error(`fail fetch value from parameter store key: ${key}`)
    }

    return value
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getValueFromParameterStore.name}`)
  }
}

const getValueFromStackOutputByKey = async (key: string): Promise<string> => {
  console.log(`start ${getValueFromStackOutputByKey.name} key: ${key}`)

  try {
    const stackName = AWS_GITHUB_TRIGGER_STACK_NAME
    console.log(`stackName: ${stackName}`)
    const exportedOutputKey = key
    const stack = await cloudformation.describeStacks({ StackName: stackName }).promise()

    if (!stack || stack.Stacks?.length === 0 || !stack!.Stacks![0].Outputs) {
      throw new Error(`undefined stack outputs key: ${key}`)
    }

    const outputs = stack.Stacks![0].Outputs
    console.log(`outputs: ${outputs}`)
    const output = outputs.find((o) => o.OutputKey === exportedOutputKey)
    if (!output) {
      throw new Error(`undefined stack output key: ${key}`)
    }

    const value = output.OutputValue
    console.log(`output value : ${value}`)

    if (!value) {
      throw new Error(`undefined value from output key: ${key}`)
    }

    return value
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getValueFromStackOutputByKey.name}`)
  }
}

const getValueFromSecretManager = async (secretName: string, keyName: string): Promise<string> => {
  console.log(`start ${getValueFromSecretManager.name} secretName: ${secretName} keyName: ${keyName}`)

  try {
    const res = await secretsManager.getSecretValue({ SecretId: secretName }).promise()
    if (!res || !res.SecretString) {
      throw new Error('undefined Secret data')
    }

    const value = JSON.parse(res.SecretString)[keyName] as string
    if (!value) {
      throw new Error('undefined Secret data')
    }

    console.log(`secret value: ${value}`)

    return value
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getValueFromSecretManager.name}`)
  }
}
