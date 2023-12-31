import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import path = require('path')
import {
  AWS_GITHUB_TRIGGER_STACK_NAME,
  AWS_COMMON_SERVICE_STACK_NAME,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY,
  AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY,
  AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY,
  AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY,
  OWNER_NAME,
  REPOSITORY_NAME,
  SECRET_GITHUB_TOKEN_NAME,
  SECRET_GITHUB_TOKEN_KEY,
  GITHUB_CONNECTION_ARN_SSM_KEY,
  AWS_EXPORT_INVALIDATE_CLOUDFRONT_CACHE_LAMBDA_NAME_KEY,
  AWS_ACCOUNT_ID,
  REGION,
} from './const'

//  GithubへのPushに紐づいて実行されるLambdaを作成する
export class GithubTriggerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: AWS_ACCOUNT_ID,
        region: REGION,
      },
    })

    // GithubへのPUSHでトリガーされるLambda アクセスするので権限を付与しておく。
    const githubBranchPushTriggerLambda = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'githubBranchPushTriggerLambda',
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        entry: path.join(__dirname, '../handlers/github-branch-push-trigger-lambda.ts'),
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        // lambdaで使用する環境変数をセット
        environment: {
          AWS_GITHUB_TRIGGER_STACK_NAME,
          AWS_COMMON_SERVICE_STACK_NAME,
          AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY,
          AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY,
          AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY,
          AWS_EXPORT_INVALIDATE_CLOUDFRONT_CACHE_LAMBDA_NAME_KEY,
          AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY,
          OWNER_NAME,
          REPOSITORY_NAME,
          SECRET_GITHUB_TOKEN_NAME,
          SECRET_GITHUB_TOKEN_KEY,
          GITHUB_CONNECTION_ARN_SSM_KEY,
        },
      }
    )
    githubBranchPushTriggerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'codepipeline:ListPipelines',
          'cloudformation:DescribeStacks',
          'cloudformation:ListStacks',
          'codepipeline:CreatePipeline',
          'codepipeline:DeletePipeline',
          'iam:PassRole', // Lambdaがさまざまなサービス権限をPipelineに委譲するための権限
          'ssm:GetParameter',
          'codestar-connections:PassConnection', // LambdaがGithubと接続を確立するための権限
          'codebuild:CreateProject',
          'codebuild:DeleteProject',
          'codebuild:BatchGetProjects',
          'secretsmanager:GetSecretValue',
          'ses:SendEmail',
        ],
        resources: ['*'],
      })
    )

    // 上記のLambdaをAPIとして公開する
    const githubBranchPushTriggerApi = new apigateway.LambdaRestApi(this, 'githubBranchPushTriggerApi', {
      handler: githubBranchPushTriggerLambda,
      restApiName: 'githubBranchPushTriggerApi',
      deploy: true,
      proxy: false,
    })
    const pushTriggerWebhook = githubBranchPushTriggerApi.root.addResource('webhook')
    // githubからのポストリクエストを受け入れる
    pushTriggerWebhook.addMethod('POST')

    // Githubのブランチの削除をトリガーとするLambda
    const githubBranchDeleteTriggerLambda = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'githubBranchDeleteTriggerLambda',
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        entry: path.join(__dirname, '../handlers/github-branch-delete-trigger-lambda.ts'),
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        // lambdaで使用する環境変数をセット
        environment: {
          AWS_COMMON_SERVICE_STACK_NAME,
          AWS_EXPORT_SOURCE_CODE_BUCKET_NAME_KEY,
        },
      }
    )
    githubBranchDeleteTriggerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:ListStacks',
          'cloudformation:DeleteStack',
          'codepipeline:ListPipelines',
          'codepipeline:DeletePipeline',
          'iam:PassRole', // Lambdaがさまざまなサービス権限をPipelineに委譲するための権限
          'ssm:GetParameter',
          'codebuild:DeleteProject',
          'codebuild:BatchGetProjects',
          's3:ListBucket',
          's3:DeleteObject',
          'ses:SendEmail',
        ],
        resources: ['*'],
      })
    )
    // 上記のLambdaをAPIとして公開する
    const githubBranchDeleteTriggerApi = new apigateway.LambdaRestApi(this, 'githubBranchDeleteTriggerApi', {
      handler: githubBranchDeleteTriggerLambda,
      restApiName: 'githubBranchDeleteTriggerApi',
      deploy: true,
      proxy: false,
    })
    const deleteTriggerWebhook = githubBranchDeleteTriggerApi.root.addResource('webhook')
    // githubからのポストリクエストを受け入れる
    deleteTriggerWebhook.addMethod('POST')

    // codebuild用のRoleを作成してエクスポートしておく
    const codebuildRole = new iam.Role(this, 'githubTriggerCodeBuildRole', {
      roleName: 'githubTriggerCodeBuildRole',
      description: 'role for codebuild triggered by github event.',
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    })
    const codebuildPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        // cdkコマンド実行するための権限
        'ssm:GetParameter',
        'cloudformation:*',
        'iam:PassRole',
        // codebuildがCloudWatchにログを出力する権限
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'], // 実際の環境では適切なリソースのARNを指定することを推奨します
    })
    codebuildRole.addToPolicy(codebuildPolicy)
    new cdk.CfnOutput(this, 'exportGithubTriggerCodeBuildRoleArn', {
      value: codebuildRole.roleArn,
      description: 'role for codebuild triggered by github event.',
      exportName: AWS_EXPORT_GITHUB_TRIGGER_CODEBUILD_ROLE_ARN_KEY,
    })

    // pipeline用のRoleを作成してエクスポートしておく
    const pipelineRole = new iam.Role(this, 'githubTriggerPipelineRole', {
      roleName: 'githubTriggerPipelineRole',
      description: 'role for pipeline triggered by github event.',
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
    })
    const pipelinePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'codestar-connections:UseConnection',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        'codebuild:StartBuild',
        'codebuild:BatchGetBuilds',
        'lambda:InvokeFunction',
      ],
      resources: ['*'], // 実際の環境では適切なリソースのARNを指定することを推奨します
    })
    pipelineRole.addToPolicy(pipelinePolicy)
    new cdk.CfnOutput(this, 'exportGithubTriggerPipelineRoleArn', {
      value: pipelineRole.roleArn,
      description: 'role for pipeline triggered by github event.',
      exportName: AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ROLE_ARN_KEY, // .envの値を参照したい
    })

    // Pipelineの実行結果を通知するためのSNSトピックを作成して、CloudWatchと紐づける
    // 通知の流れとしては、Pipelineのステータス変更→CloudWatch検知→SNSにてメッセージを送信→email
    const pipelineStatusNotifyTopic = new sns.Topic(this, 'PipelineStatusNotifyTopic', {
      displayName: 'PipelineStatusNotifyTopic',
      topicName: 'PipelineStatusNotifyTopic',
    })
    const pipelineStatusNotifyRule = new events.Rule(this, 'PipelineStatusNotifyRule', {
      eventPattern: {
        source: ['aws.codepipeline'],
        detailType: ['CodePipeline Pipeline Execution State Change'],
        detail: {
          state: ['SUCCEEDED', 'FAILED'],
        },
      },
    })
    const pipelineStatusNotifyTarget = new targets.SnsTopic(pipelineStatusNotifyTopic)
    pipelineStatusNotifyRule.addTarget(pipelineStatusNotifyTarget)
    // 開発者用のメールアドレス一覧を取得してサブスクライバーとして設定
    const devEmails = ssm.StringParameter.valueFromLookup(this, '/developer_emails').split(',')
    for (const email of devEmails) {
      const subscription = new subscriptions.EmailSubscription(email.trim())
      pipelineStatusNotifyTopic.addSubscription(subscription)
    }

    // Pipelineのステージ間で共有するArtifactsを保管するS3バケットを生成してBucketネームをエクスポート
    const artifactBucket = new s3.Bucket(this, 'githubTriggerPipelineArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    new cdk.CfnOutput(this, 'exportGithubTriggerPipelineArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'bucket to store artifact sharing pipeline',
      exportName: AWS_EXPORT_GITHUB_TRIGGER_PIPELINE_ARTIFACT_BUCKET_NAME_KEY, // .envの値を参照したい
    })

    // CloudFrontにキャッシュされているコンテンツを破棄するためのLambda
    const invalidateCloudFrontCacheLambda = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'invalidateCloudFrontCacheLambda',
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        entry: path.join(__dirname, '../handlers/invalidate-cloudfront-cache-lambda.ts'),
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          AWS_COMMON_SERVICE_STACK_NAME,
          AWS_EXPORT_CLOUDFRONT_DISTRIBUTION_ID_KEY,
        },
      }
    )
    invalidateCloudFrontCacheLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudfront:CreateInvalidation',
          // Pipelineで実行されるLambdaが実行結果をPipelineに通知するため
          'codepipeline:PutJobSuccessResult',
          'codepipeline:PutJobFailureResult',
        ],
        resources: ['*'],
      })
    )
    invalidateCloudFrontCacheLambda.addPermission('InvokedByCodePipelineForInvalidateCacheLambda', {
      action: 'lambda:InvokeFunction',
      principal: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
    })
    new cdk.CfnOutput(this, AWS_EXPORT_INVALIDATE_CLOUDFRONT_CACHE_LAMBDA_NAME_KEY, {
      value: invalidateCloudFrontCacheLambda.functionName,
      exportName: AWS_EXPORT_INVALIDATE_CLOUDFRONT_CACHE_LAMBDA_NAME_KEY,
    })
  }
}
