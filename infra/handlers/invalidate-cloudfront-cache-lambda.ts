import { CloudFront } from 'aws-sdk'
import { getValueFromStackOutputByKey } from './common'
import { CreateInvalidationRequest } from 'aws-sdk/clients/cloudfront'
import { CodePipelineEvent } from 'aws-lambda'

const { AWS_COMMON_SERVICE_STACK_NAME = '', AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY = '' } = process.env

const cloudfront = new CloudFront()

// このLambdaはPipelineのステップの一部として呼び出されます
export const handler = async (event: CodePipelineEvent): Promise<any> => {
  console.log(event)
  console.log(event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters)

  try {
    // const [distributionId] = await getValueFromStackOutputByKey(
    //   AWS_COMMON_SERVICE_STACK_NAME,
    //   AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY
    // )
    // const params: CreateInvalidationRequest = {
    //   DistributionId: distributionId,
    //   InvalidationBatch: {
    //     CallerReference: new Date().getTime().toString(),
    //     Paths: {
    //       Quantity: 1,
    //       Items: [`/${branchName}/*`],
    //     },
    //   },
    // }
    // await cloudfront.createInvalidation(params).promise()
    // console.log(`Invalidate cloudfront cache : ${branchName}`)
    console.log('hello')

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'invalidate cloudfront cache.' }),
    }
  } catch (e) {
    console.log(e)
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'internal server error.' }),
    }
  }
}
