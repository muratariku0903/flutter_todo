import { S3, Lambda, AWSError } from 'aws-sdk'
import { CodePipelineEvent } from 'aws-lambda'
import { CodePipeline } from 'aws-sdk'
import AdmZip = require('adm-zip')

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

    // 問題なのはS3のデータがパブリックアクセスが許可されているこおと。ベストなのはこのdeploy-api-lambdaからしかアクセスさせたくない
    const zipFile = await s3.getObject({ Bucket: bucketName, Key: `${branchName}/api/api.zip` }).promise()
    console.log(zipFile)

    const zip = new AdmZip(zipFile.Body as Buffer)

    console.log(zip.getEntries().length)
    zip.getEntries().forEach(async (entry) => {
      console.log(entry)
      console.log(entry.name)
      console.log(entry.entryName)
      if (entry.name.endsWith('ts')) {
        const handlerName = `${entry.name.replace('.ts', '')}.handler`
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

// const createLambdaFunction = async (
//   functionName: string,
//   buffer: Buffer
// ): Promise<> => {
//   const params = {}

//   const lambdaFunction = await lambda.createFunction(params).promise()

//   return lambdaFunction.FunctionName
// }
