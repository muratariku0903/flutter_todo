import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda'
import { CodeBuild } from 'aws-sdk'
import { CodePipelineClient, ListPipelinesCommand, DeletePipelineCommand } from '@aws-sdk/client-codepipeline'
import { CodeBuildClient, DeleteProjectCommand } from '@aws-sdk/client-codebuild'
import { getValueFromStackOutputByKey, notifyAllMembers } from './common'
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
const { AWS_REGION, AWS_COMMON_SERVICE_STACK_NAME = '', AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY = '' } = process.env

// Pipeline、CodeBuild,S3、　APIとか ソースコードを格納するバケットとアーティファクトを格納するバケットを削除する必要がある
// ビルドされたソースコードのオブジェクト自体は６０弱なのでそこまでLambdaで処理しても時間がかからず費用もないので直接Lambdaで削除することにする
const codePipelineClient = new CodePipelineClient({ region: AWS_REGION })
const codeBuildClient = new CodeBuildClient({ region: AWS_REGION })
const s3Client = new S3Client({ region: AWS_REGION })
const cloudformationClient = new CloudFormationClient({ region: AWS_REGION })
const codebuild = new CodeBuild()

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let branchName = ''

  try {
    let body = JSON.parse(event.body ?? '{}')

    branchName = body.ref.split('/').pop()

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
    // ただ、Artifactに関してはdevelopの階層にどんどん追加されているので削除してもしなくてもどちらもでいい気がする。
    // てか、Artifactって直接アプリを表示するのに使われないし、ぶっちゃけ、バケットの内の全てを削除してもいいのでは？
    const [sourceCodeBucketName] = await Promise.all([
      getValueFromStackOutputByKey(AWS_COMMON_SERVICE_STACK_NAME, AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY),
    ])
    await deleteS3Directory(sourceCodeBucketName, branchName)
    console.log(`Delete S3 Directory ${branchName}`)

    // Stack(API Gateway Lambda)を削除
    const stackName = `DeploymentsStack-${branchName}`
    const describeCmd = new DescribeStacksCommand({ StackName: stackName })
    const describeCmdRes = await cloudformationClient.send(describeCmd)
    if (describeCmdRes.Stacks && describeCmdRes.Stacks.length > 0) {
      const stackDeleteCmd = new DeleteStackCommand({ StackName: `DeploymentsStack-${branchName}` })
      await cloudformationClient.send(stackDeleteCmd)
      console.log(`Delete Stack: ${stackName}`)
    }

    await notifyAllMembers('リソースの削除に成功しました!', `${branchName}のリソースを削除しました。`)

    return {
      statusCode: 200,
      body: JSON.stringify(`Delete AWS Resource for ${branchName}`),
    }
  } catch (e) {
    console.error(e)

    await notifyAllMembers('Pipelineのリソース削除に失敗しました', `${branchName}のリソースを削除に失敗しました`)

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'internal server error.' }),
    }
  }
}

// ListObjectsV2Commandが一度にリストアップできるオブジェクトには限りがあるので再起的に実行する
const deleteS3Directory = async (bucketName: string, directoryName: string): Promise<void> => {
  // ディレクトリ内のオブジェクトをリストアップ
  const listParams = { Bucket: bucketName, Prefix: `${directoryName}/` }
  const listCmd = new ListObjectsV2Command(listParams)
  const listedObjects = await s3Client.send(listCmd)
  console.log(`delete target list object ${JSON.stringify(listedObjects)}`)

  if (!listedObjects.Contents || listedObjects.Contents.length === 0) return

  // 削除対象のオブジェクトを準備
  const deleteParams = {
    Bucket: bucketName,
    Delete: { Objects: listedObjects.Contents.map(({ Key }) => ({ Key })) },
  }

  // オブジェクトの削除
  const deleteCmd = new DeleteObjectsCommand(deleteParams)
  await s3Client.send(deleteCmd)

  // すべてのオブジェクトが削除されるまで再帰的に呼び出し
  if (listedObjects.IsTruncated) await deleteS3Directory(bucketName, directoryName)
}
