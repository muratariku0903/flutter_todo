import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import { AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY, AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY } from './const'

export class CommonServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ソースコードを保存するバケット
    const bucket = new s3.Bucket(this, 'todoS3BucketId', {
      // arrow public read
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      websiteIndexDocument: 'index.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    new cdk.CfnOutput(this, 'exportSourceCodeBucketName', {
      value: bucket.bucketName,
      description: 'bucket to store source code',
      exportName: AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY,
    })

    // ブランチごとの配信パスを分ける
    const cloudFront = new cloudfront.CloudFrontWebDistribution(this, 'todoWebDistributionId', {
      originConfigs: [
        {
          customOriginSource: {
            domainName: bucket.bucketWebsiteDomainName,
            originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          },
          behaviors: [
            { pathPattern: '/master/*', isDefaultBehavior: false, defaultTtl: cdk.Duration.days(1) },
            { pathPattern: '/develop/*', isDefaultBehavior: false, defaultTtl: cdk.Duration.days(1) },
            { pathPattern: '/feat/*', isDefaultBehavior: false, defaultTtl: cdk.Duration.days(1) },
            { isDefaultBehavior: true },
          ],
        },
      ],
    })
    new cdk.CfnOutput(this, 'exportCloudFrontDistributionId', {
      value: cloudFront.distributionId,
      description: 'distribution to share cached contents',
      exportName: AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY, // .envの値を参照したい
    })
  }
}
