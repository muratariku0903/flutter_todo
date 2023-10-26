import { S3, Lambda } from 'aws-sdk'
import { CodePipelineEvent } from 'aws-lambda'
import { CodePipeline } from 'aws-sdk'
import AdmZip from 'adm-zip'

const codepipeline = new CodePipeline()
const s3 = new S3()
const lambda = new Lambda()

// このLambdaはPipelineのステップの一部として呼び出されます
export const handler = async (event: CodePipelineEvent): Promise<void> => {
  const jobId = event['CodePipeline.job'].id
  const { branchName, bucketName } = JSON.parse(
    event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters
  )

  try {
    console.log(`branchName: ${branchName}`)

    const zipFile = await s3.getObject({ Bucket: bucketName, Key: `${branchName}/api/api.zip` }).promise()
    console.log(zipFile)

    const zip = new AdmZip(zipFile.Body as Buffer)
    zip.getEntries().forEach(async (entry) => {
      console.log(entry)
      if (entry.name.endsWith('js')) {
        const handlerName = `${entry.name.replace('.js', '')}.handler`
        console.log(handlerName)
        console.log(entry.getData())
      }
    })

    // const distributionId = await getValueFromStackOutputByKey(
    //   AWS_COMMON_SERVICE_STACK_NAME,
    //   AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY
    // )
    // console.log(`distributionId: ${distributionId}`)

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

    // 完了をPipelineに通知
    await codepipeline.putJobSuccessResult({ jobId }).promise()
  } catch (e) {
    await codepipeline
      .putJobFailureResult({ jobId, failureDetails: { message: JSON.stringify(e), type: 'JobFailed' } })
      .promise()
    console.log(e)
  }
}
