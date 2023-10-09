import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyHandler } from 'aws-lambda'
import { CloudFormation } from 'aws-sdk'
import {
  CodePipelineClient,
  CreatePipelineCommand,
  ListPipelinesCommand,
  CreatePipelineCommandInput,
} from '@aws-sdk/client-codepipeline'
import { PipelineSummary } from 'aws-sdk/clients/codepipeline'
const {
  AWS_REGION,
  AWS_GITHUB_TRIGGER_STACK_NAME,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY,
} = process.env

const codePipelineClient = new CodePipelineClient({ region: AWS_REGION })
const cloudformation = new CloudFormation()

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
  console.log(`start ${createPipeline.name}`)

  try {
    // pipelineリソースを構築するための必要なロールやS3バケットキーを取得
    const [roleArn, artifactBucketName] = await Promise.all([
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY ?? ''),
      getValueFromStackOutputByKey(AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY ?? ''),
    ])

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
                  provider: 'GitHub',
                },
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
