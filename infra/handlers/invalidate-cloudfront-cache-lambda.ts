import { CloudFront } from 'aws-sdk'
import { getValueFromStackOutputByKey } from './common'
import { CreateInvalidationRequest } from 'aws-sdk/clients/cloudfront'
import { CodePipelineEvent } from 'aws-lambda'
import { CodePipeline } from 'aws-sdk'

const { AWS_COMMON_SERVICE_STACK_NAME = '', AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY = '' } = process.env

const codepipeline = new CodePipeline()
const cloudfront = new CloudFront()

// このLambdaはPipelineのステップの一部として呼び出されます
export const handler = async (event: CodePipelineEvent): Promise<void> => {
  const jobId = event['CodePipeline.job'].id
  const branchName = event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters

  try {
    console.log(`branchName: ${branchName}`)

    const [distributionId] = await getValueFromStackOutputByKey(
      AWS_COMMON_SERVICE_STACK_NAME,
      AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY
    )
    console.log(`distributionId: ${distributionId}`)

    const params: CreateInvalidationRequest = {
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: new Date().getTime().toString(),
        Paths: {
          Quantity: 1,
          Items: [`/${branchName}/*`],
        },
      },
    }
    await cloudfront.createInvalidation(params).promise()
    console.log(`Invalidate cloudfront cache : ${branchName}`)

    // 完了をPipelineに通知
    await codepipeline.putJobSuccessResult({ jobId }).promise()
  } catch (e) {
    await codepipeline
      .putJobFailureResult({ jobId, failureDetails: { message: JSON.stringify(e), type: 'JobFailed' } })
      .promise()
    console.log(e)
  }
}
