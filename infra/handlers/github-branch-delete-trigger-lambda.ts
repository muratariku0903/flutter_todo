import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda'
import { CodeBuild, CodePipeline } from 'aws-sdk'
import {
  CodePipelineClient,
  CreatePipelineCommand,
  ListPipelinesCommand,
  CreatePipelineCommandInput,
  DeletePipelineCommand,
} from '@aws-sdk/client-codepipeline'
import { CreateProjectInput } from 'aws-sdk/clients/codebuild'
import { CodeBuildClient, DeleteProjectCommand } from '@aws-sdk/client-codebuild'
import { getValueFromParameterStore, getValueFromStackOutputByKey } from './common'
import { S3ControlClient, CreateJobCommand, CreateJobCommandInput } from '@aws-sdk/client-s3-control'
// import { S3Client, DeleteBucketCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
const {
  AWS_REGION,
  AWS_ACCOUNT_ID = '',
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

// 削除するリソースはなんだろう？
// Pipeline、CodeBuild,S3、　APIとか ソースコードを格納するバケットとアーティファクトを格納するバケットを削除する必要がある
const codePipelineClient = new CodePipelineClient({ region: AWS_REGION })
const codeBuildClient = new CodeBuildClient({ region: AWS_REGION })
const s3Client = new S3ControlClient({ region: AWS_REGION })
const codebuild = new CodeBuild()
const codepipeline = new CodePipeline()

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    let body = JSON.parse(event.body ?? '{}')

    let branchName: string = body.ref.split('/').pop()

    // Pipelineリソースを削除（Pipelineが存在するかどうかをチェックした方がいい）
    const pipelineName = `pipeline-${branchName}`
    const listPipelinesOutput = await codePipelineClient.send(new ListPipelinesCommand({}))
    const existPipeline = listPipelinesOutput.pipelines?.find((pipeline) => pipeline.name === `pipeline-${branchName}`)
    if (existPipeline) {
      const deletePipelineCmd = new DeletePipelineCommand({ name: pipelineName })
      await codePipelineClient.send(deletePipelineCmd)
      console.log(`Delete Pipeline: pipeline-${branchName}`)
    }

    // CodeBuildリソースの削除（CodeBuildProjectが存在するかどうかをチェックした方がいい）
    const buildspecNames = ['app_buildspec.yaml', 'api_buildspec.yaml']
    await Promise.all(
      buildspecNames.map(async (buildspecName) => {
        const buildProjectName = `CodeBuild-${branchName}-${buildspecName.split('.')[0]}`
        const existCodeBuildProject = await codebuild.batchGetProjects({ names: [buildProjectName] }).promise()
        if (existCodeBuildProject.projects && existCodeBuildProject.projects?.length > 0) {
          const deleteCodBuildCmd = new DeleteProjectCommand({ name: buildProjectName })
          await codeBuildClient.send(deleteCodBuildCmd)
          console.log(`Delete CodeBuildProject: ${buildProjectName}`)
        }
      })
    )

    // ソースコードとArtifactを格納するS3バケットリソース削除
    const [artifactBucketName, sourceCodeBucketName] = await Promise.all([
      getValueFromStackOutputByKey(
        AWS_GITHUB_TRIGGER_STACK_NAME,
        AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY
      ),
      getValueFromStackOutputByKey(AWS_COMMON_SERVICE_STACK_NAME, AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY),
    ])

    const jobParams: CreateJobCommandInput = {
      AccountId: AWS_ACCOUNT_ID,
      ConfirmationRequired: false, // 手動での確認を無効
      Operation: { S3DeleteObjectTagging: {} },
      Report: {
        Bucket: sourceCodeBucketName,
        Format:
      }
      
    }

    const s3JobCmd = new CreateJobCommand(jobParams)
    await s3Client.send(s3JobCmd)

    return {
      statusCode: 200,
      body: JSON.stringify(`Delete AWS Resource for ${branchName}`),
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
