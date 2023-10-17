import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'

export class CommonServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ソースコードを保存するバケット
    const bucket = new s3.Bucket(this, 'todoS3BucketId', {
      // arrow public read
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    new cdk.CfnOutput(this, 'exportSourceCodeBucketName', {
      value: bucket.bucketName,
      description: 'bucket to store source code',
      exportName: 'exportSourceCodeBucketName', // .envの値を参照したい
    })

    // ブランチごとの配信パスを分ける
    new cloudfront.CloudFrontWebDistribution(this, 'todoWebDistributionId', {
      originConfigs: [
        {
          // set origin server
          s3OriginSource: {
            s3BucketSource: bucket,
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
  }
}
