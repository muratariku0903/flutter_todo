import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline'
import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions'
import * as iam from 'aws-cdk-lib/aws-iam'

export class PipelineStack extends cdk.Stack {
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

    const project = new codebuild.Project(this, 'todoBuildProjectId', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: ['flutter build web'],
          },
        },
        artifacts: {
          // store of created artifacts
          'base-directory': 'build/web',
          files: ['**/*'],
        },
      }),
    })

    const sourceOutput = new codepipeline.Artifact()
    const buildOutput = new codepipeline.Artifact()

    // pipeline
    const pipeline = new codepipeline.Pipeline(this, 'todoPipelineId', {
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipelineActions.GitHubSourceAction({
              actionName: 'Github',
              owner: 'muratariku0903',
              repo: 'flutter_todo',
              // refer to Github token stored in AWS secret manager, this token is used to AWS accessing to Github
              oauthToken: cdk.SecretValue.secretsManager('github-pipeline-token', { jsonField: 'github-token' }),
              // source code is stored in to sourceOutput as artifact and send to next stage of 'Build'
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipelineActions.CodeBuildAction({
              actionName: 'CodeBuild',
              project,
              input: sourceOutput,
              // builded source code is stored in to buildOutput as artifact and send to next stage of 'Deploy'
              outputs: [buildOutput],
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipelineActions.S3DeployAction({
              actionName: 'Deploy',
              input: buildOutput,
              bucket: bucket,
            }),
          ],
        },
      ],
    })

    // grant permissions to invalidate CloudFront cache
    const invalidatePermission = new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: ['*'],
      effect: iam.Effect.ALLOW,
    })
    pipeline.addToRolePolicy(invalidatePermission)

    // deploy flutter build file
    new s3deploy.BucketDeployment(this, 'todoDeployId', {
      sources: [s3deploy.Source.asset('../build/web')],
      destinationBucket: bucket,
      distribution: distribution,
      distributionPaths: ['/*'],
    })
  }
}
