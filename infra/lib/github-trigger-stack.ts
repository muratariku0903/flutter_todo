import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as codestarconnections from 'aws-cdk-lib/aws-codestarconnections'
import path = require('path')

//  GithubへのPushに紐づいて実行されるLambdaを作成する
export class GithubTriggerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // GithubへのPUSHでトリガーされるLambda アクセスするので権限を付与しておく。
    const githubTriggerLambda = new cdk.aws_lambda_nodejs.NodejsFunction(this, 'githubTriggerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../handlers/github-trigger-lambda.ts'),
      // lambdaで使用する環境変数をセット
      environment: {
        AWS_GITHUB_TRIGGER_STACK_NAME: 'GithubTriggerStack',
        AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY: 'exportGithubTriggerPipelineRoleArn',
        AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY: 'exportGithubTriggerPipelineArtifactBucketName',
        OWNER_NAME: 'muratariku0903',
        REPOSITORY_NAME: 'flutter_todo',
      },
    })
    githubTriggerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'codepipeline:ListPipelines',
          'cloudformation:DescribeStacks',
          'cloudformation:ListStacks',
          'codepipeline:CreatePipeline',
          'iam:PassRole',
        ],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      })
    )

    // 上記のLambdaをAPIとして公開する
    const githubTriggerApi = new apigateway.LambdaRestApi(this, 'githubTriggerApi', {
      handler: githubTriggerLambda,
      restApiName: 'githubTriggerApi',
      deploy: true,
      proxy: false,
    })
    const webhook = githubTriggerApi.root.addResource('webhook')
    // githubからのポストリクエストを受け入れる
    webhook.addMethod('POST')

    // pipeline用のRoleを作成してエクスポートしておく
    const pipelineRole = new iam.Role(this, 'githubTriggerPipelineRole', {
      roleName: 'githubTriggerPipelineRole',
      description: 'role for pipeline triggered by github event.',
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
    })
    pipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'))

    new cdk.CfnOutput(this, 'exportGithubTriggerPipelineRoleArn', {
      value: pipelineRole.roleArn,
      description: 'role for pipeline triggered by github event.',
      exportName: 'exportGithubTriggerPipelineRoleArn', // .envの値を参照したい
    })

    // Pipelineのステージ間で共有するArtifactsを保管するS3バケットを生成してBucketネームをエクスポート
    const artifactBucket = new s3.Bucket(this, 'githubTriggerPipelineArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    new cdk.CfnOutput(this, 'exportGithubTriggerPipelineArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'bucket to store artifact sharing pipeline',
      exportName: 'exportGithubTriggerPipelineArtifactBucketName', // .envの値を参照したい
    })

    // PipelineのソースステージでGithubと接続するためのコネクション
    // const connections = new codestarconnections.CfnConnection(this, 'connections', {
    //   providerType: 'Github',
    // })
    // const sourceOutput = new codepipeline.Artifact()
    // const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
    //   actionName: 'BitBucket_Source',
    //   owner: 'aws',
    //   repo: 'aws-cdk',
    //   output: sourceOutput,
    //   connectionArn: 'arn:aws:codestar-connections:us-east-1:123456789012:connection/12345678-abcd-12ab-34cdef5678gh',
    // })
  }
}
