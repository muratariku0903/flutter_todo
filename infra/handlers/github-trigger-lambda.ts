import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda'
import { CloudFormation, SSM, CodeBuild, SecretsManager } from 'aws-sdk'
import {
  CodePipelineClient,
  CreatePipelineCommand,
  ListPipelinesCommand,
  CreatePipelineCommandInput,
} from '@aws-sdk/client-codepipeline'
import { PipelineSummary } from 'aws-sdk/clients/codepipeline'
import { CreateProjectInput } from 'aws-sdk/clients/codebuild'
const {
  AWS_REGION,
  AWS_GITHUB_TRIGGER_STACK_NAME,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY,
  OWNER_NAME,
  REPOSITORY_NAME,
  GITHUB_CONNECTION_ARN_SSM_KEY,
} = process.env

const codePipelineClient = new CodePipelineClient({ region: AWS_REGION })
const cloudformation = new CloudFormation()
const ssm = new SSM()
const codebuild = new CodeBuild()
const secretsManager = new SecretsManager()

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    let body = JSON.parse(event.body ?? '{}')

    let branchName: string = body.ref.split('/').pop()
    console.log('Branch Name:', branchName)

    // 既存のPipelineがあるかチェック
    const existPipeline = await getExistPipeline(branchName)
    if (existPipeline) {
      console.log(`Pipeline ${existPipeline.name} already exists.`)

      return {
        statusCode: 200,
        body: JSON.stringify('Finish! because Pipeline already exists'),
      }
    }

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

const getExistPipeline = async (branchName: string): Promise<PipelineSummary | undefined> => {
  console.log(`start ${getExistPipeline.name}`)

  try {
    const listPipelinesOutput = await codePipelineClient.send(new ListPipelinesCommand({}))
    const existPipeline = listPipelinesOutput.pipelines?.find((pipeline) => pipeline.name === `pipeline-${branchName}`)

    return existPipeline
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getExistPipeline.name}`)
  }
}

const createPipeline = async (branchName: string): Promise<void> => {
  console.log(`start ${createPipeline.name}:${branchName}`)

  try {
    // pipelineリソースを構築するための必要なロールやS3バケットキーを取得
    const [roleArn, artifactBucketName, connectionArn] = await Promise.all([
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY ?? ''),
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY ?? ''),
      getValueFromParameterStore(GITHUB_CONNECTION_ARN_SSM_KEY ?? ''),
    ])

    // codebuildプロジェクトを作成
    const codebuildProjectName = await createCodeBuildProject(branchName, artifactBucketName)

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
                outputArtifacts: [{ name: 'SourceOutput' }],
              },
            ],
          },
          {
            name: 'Build',
            actions: [
              {
                // ソースコードのBuildの仕方はブランチごとに変更できた方がいい。
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
                outputArtifacts: [{ name: 'buildOutput' }],
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

const createCodeBuildProject = async (branchName: string, artifactBucketName: string): Promise<string> => {
  console.log(`start ${createCodeBuildProject.name}:${branchName}`)

  const projectName = `CodeBuild-${branchName}`

  try {
    // codebuildプロジェクトを構築するための必要なロールを取得
    const [roleArn] = await Promise.all([
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY ?? ''),
    ])

    const params: CreateProjectInput = {
      name: projectName,
      description: `Build project for branch : ${branchName}`,
      source: {
        // コードパイプラインのステージ間でソースコードを受け取る前提
        type: 'CODEPIPELINE',
      },
      artifacts: {
        type: 'S3',
        location: artifactBucketName,
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
      throw new Error('fail fetch value from parameter store')
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
      throw new Error('undefined stack outputs')
    }

    const outputs = stack.Stacks![0].Outputs
    console.log(`outputs: ${outputs}`)
    const output = outputs.find((o) => o.OutputKey === exportedOutputKey)
    if (!output) {
      throw new Error('undefined stack output')
    }

    const value = output.OutputValue
    console.log(`output value : ${value}`)

    if (!value) {
      throw new Error('undefined value from output')
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
