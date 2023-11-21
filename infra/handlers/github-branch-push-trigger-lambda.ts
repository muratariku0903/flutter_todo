import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda'
import { CodeBuild, CodePipeline } from 'aws-sdk'
import {
  CodePipelineClient,
  CreatePipelineCommand,
  ListPipelinesCommand,
  CreatePipelineCommandInput,
} from '@aws-sdk/client-codepipeline'
import { CreateProjectInput } from 'aws-sdk/clients/codebuild'
const {
  AWS_REGION,
  AWS_COMMON_SERVICE_STACK_NAME = '',
  AWS_GITHUB_TRIGGER_STACK_NAME = '',
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY = '',
  AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY = '',
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY = '',
  AWS_EXPORT_INVALIDATE_CLOUDFRONT_CACHE_LAMBDA_NAME_KEY = '',
  AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY = '',
  OWNER_NAME = '',
  REPOSITORY_NAME = '',
  GITHUB_CONNECTION_ARN_SSM_KEY = '',
} = process.env
import { getValueFromParameterStore, getValueFromStackOutputByKey, notifyAllMembers, sendEmail } from './common'

const codePipelineClient = new CodePipelineClient({ region: AWS_REGION })
const codebuild = new CodeBuild()
const codepipeline = new CodePipeline()

// githubへのプッシュごとに毎回実行されるから毎回ブランチごとにPipelineが生成される
// 単純に、Pipelineを作らずに、ソースコードを取得して、ビルドしてS3にデプロイすればいいだけじゃないの？
export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let branchName = ''

  try {
    let body = JSON.parse(event.body ?? '{}')

    branchName = body.ref.split('/').pop()
    console.log('Branch Name:', branchName)

    // API(Lambda)はブランチが削除された時もトリガーされてしまうのでその時は特にリソースは生成しない
    if (body.deleted) {
      return {
        statusCode: 200,
        body: JSON.stringify(`Branch deletion event ignored for ${branchName}`),
      }
    }

    // Pipelineリソースを作成
    await createPipeline(branchName)

    // 処理が全て成功したらメールで通知
    // 開発メンバー全員に通知して欲しいから、メンバーのメールをパラメーターストアで一元管理
    await notifyAllMembers('Pipelineの作成に成功しました!', `${branchName}のPipelineを作成しました。`)

    return {
      statusCode: 200,
      body: JSON.stringify(`Create AWS Resource for ${branchName}`),
    }
  } catch (e) {
    console.error(e)

    await notifyAllMembers('Pipelineの作成に失敗しました', `${branchName}のPipelineがの作成に失敗しました。`)

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'internal server error.' }),
    }
  }
}

// TODO すでにPipelineが存在していたら削除して作り直してるけど、トランザクションは大丈夫？削除だけ成功してPipeline構築が失敗するケースとか
// また処理が途中で落ちた場合、Pipelineだけ消滅してしまう。。。
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
    const [
      pipelineRoleArn,
      artifactBucketName,
      connectionArn,
      sourceCodeBucketName,
      invalidateCacheLambdaName,
      codeBuildRoleArn,
    ] = await Promise.all([
      getValueFromStackOutputByKey(AWS_GITHUB_TRIGGER_STACK_NAME, AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY),
      getValueFromStackOutputByKey(
        AWS_GITHUB_TRIGGER_STACK_NAME,
        AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY
      ),
      getValueFromParameterStore(GITHUB_CONNECTION_ARN_SSM_KEY),
      getValueFromStackOutputByKey(AWS_COMMON_SERVICE_STACK_NAME, AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY),
      getValueFromStackOutputByKey(
        AWS_GITHUB_TRIGGER_STACK_NAME,
        AWS_EXPORT_INVALIDATE_CLOUDFRONT_CACHE_LAMBDA_NAME_KEY
      ),
      getValueFromStackOutputByKey(AWS_GITHUB_TRIGGER_STACK_NAME, AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY),
    ])

    // codebuildプロジェクトを作成
    const buildspecNames = ['app_buildspec.yaml', 'api_buildspec.yaml']
    const [appCodeBuildName, apiCodeBuildName] = await Promise.all(
      buildspecNames.map((buildspecName) =>
        createCodeBuildProject(branchName, buildspecName, codeBuildRoleArn, sourceCodeBucketName)
      )
    )
    // const codebuildProjectName = await createCodeBuildProject(branchName)

    const pipelineName = `pipeline-${branchName}`
    const params: CreatePipelineCommandInput = {
      pipeline: {
        name: pipelineName,
        roleArn: pipelineRoleArn,
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
            // Buildステージ内でCDKアプリケーションをデプロイする
            // 正直FlutterアプリのビルドとAPIのビルドって独立してるから並列でビルド処理したいんだよね
            name: 'Build',
            actions: [
              {
                name: 'AppBuildAction',
                actionTypeId: {
                  category: 'Build',
                  owner: 'AWS',
                  version: '1',
                  provider: 'CodeBuild',
                },
                configuration: {
                  ProjectName: appCodeBuildName,
                },
                inputArtifacts: [{ name: 'SourceOutput' }],
                outputArtifacts: [{ name: 'BuildOutput' }],
              },
              {
                name: 'ApiBuildAction',
                actionTypeId: {
                  category: 'Build',
                  owner: 'AWS',
                  version: '1',
                  provider: 'CodeBuild',
                },
                configuration: {
                  ProjectName: apiCodeBuildName,
                },
                inputArtifacts: [{ name: 'SourceOutput' }],
              },
            ],
          },
          {
            name: 'Deploy',
            actions: [
              {
                name: 'DeploySourceAction',
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
          {
            name: 'InvalidateCache',
            actions: [
              {
                name: 'InvalidateCacheAction',
                actionTypeId: {
                  category: 'Invoke',
                  owner: 'AWS',
                  provider: 'Lambda',
                  version: '1',
                },
                configuration: {
                  FunctionName: invalidateCacheLambdaName,
                  UserParameters: branchName,
                },
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

const createCodeBuildProject = async (
  branchName: string,
  buildspecName: string,
  roleArn: string,
  sourceCodeBucketName: string,
  overwriting = true
): Promise<string> => {
  console.log(`start ${createCodeBuildProject.name}:${branchName}`)

  const projectName = `CodeBuild-${branchName}-${buildspecName.split('.')[0]}`

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

    const params: CreateProjectInput = {
      name: projectName,
      description: `Build project for branch : ${branchName}`,
      source: {
        type: 'CODEPIPELINE', // コードパイプラインのステージ間でソースコードを受け取る前提
        buildspec: buildspecName, // yamlファイル名を指定
      },
      artifacts: {
        type: 'CODEPIPELINE', // コードパイプラインのステージ間でアーティファクトを受け取る前提
      },
      environment: {
        type: 'LINUX_CONTAINER',
        computeType: 'BUILD_GENERAL1_SMALL',
        // Nodejs１８系を使うため
        image: 'aws/codebuild/standard:7.0',
        // build時に参照する環境変数をセット
        environmentVariables: [
          { name: 'BRANCH_NAME', value: branchName, type: 'PLAINTEXT' },
          { name: 'BUCKET_NAME', value: sourceCodeBucketName, type: 'PLAINTEXT' },
        ],
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
