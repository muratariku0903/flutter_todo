import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as iam from 'aws-cdk-lib/aws-iam'
import { DeploymentConfig } from './deployments-config'

interface DeploymentsStackProps extends cdk.StackProps {
  branchName: string
  deploymentConfig: DeploymentConfig
}

export class DeploymentsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DeploymentsStackProps) {
    super(scope, id, props)

    // ブランチ名
    const branchName = props.branchName

    // デプロイリソースの設定情報
    const deploymentConfig = props.deploymentConfig

    // api作成
    const apiName = `api-${branchName}`
    const api = new apigateway.RestApi(this, apiName, {
      restApiName: apiName,
      deployOptions: {
        stageName: 'dev',
      },
    })

    // Lambda作成してAPI Gatewayに統合する
    deploymentConfig.apiConfigs.forEach(({ functionName, method, roles }) => {
      // Lambda作成
      const lambdaFunction = new cdk.aws_lambda_nodejs.NodejsFunction(this, functionName, {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        projectRoot: '../api',
        depsLockFilePath: '../api/package-lock.json',
        entry: `../api/src/${functionName}.ts`,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      })

      // Lambdaの権限を設定
      const lambdaRolePolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: roles,
        resources: ['*'],
      })
      lambdaFunction.addToRolePolicy(lambdaRolePolicy)

      // 作成したLambdaをAPI Gatewayに統合
      const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction)

      // HTTPメソッドを追加
      const resource = api.root.resourceForPath(functionName)
      resource.addMethod(method, lambdaIntegration)
    })
  }
}
