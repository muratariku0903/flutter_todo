import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // create S3 bucket
    const bucket = new s3.Bucket(this, 'todoS3BucketId', {
      // arrow public read
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    // CloudFront
    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'todoWebDistributionId', {
      originConfigs: [
        {
          // ser origin server
          s3OriginSource: {
            s3BucketSource: bucket,
          },
          behaviors: [{ isDefaultBehavior: true }],
        },
      ],
    })

    // deploy flutter build file
    new s3deploy.BucketDeployment(this, 'todoDeployId', {
      sources: [s3deploy.Source.asset('../build/web')],
      destinationBucket: bucket,
      distribution: distribution,
    })
  }
}
