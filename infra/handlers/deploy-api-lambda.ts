import { S3, Lambda, APIGateway, IAM } from 'aws-sdk'
import { CodePipelineEvent } from 'aws-lambda'
import { CodePipeline } from 'aws-sdk'
import AdmZip = require('adm-zip')
const { AWS_REGION } = process.env

const codepipeline = new CodePipeline()
const s3 = new S3()
const lambda = new Lambda()
const apigateway = new APIGateway({ region: AWS_REGION })
const iam = new IAM()

// このLambdaはPipelineのステップの一部として呼び出されます
export const handler = async (event: CodePipelineEvent): Promise<void> => {
  const jobId = event['CodePipeline.job'].id
  const { branchName, bucketName } = JSON.parse(
    event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters
  )
  const objectKey = `${branchName}/api/api.zip`

  try {
    console.log(`branchName: ${branchName}`)

    // S3にZip化されているハンドラーファイルを取得
    // 問題なのはS3のデータがパブリックアクセスが許可されていること。ベストなのはこのdeploy-api-lambdaからしかアクセスさせたくない
    const zipFile = await s3.getObject({ Bucket: bucketName, Key: objectKey }).promise()
    const zip = new AdmZip(zipFile.Body as Buffer)

    // zipからAPIの設定ファイルを取り出す
    const configs = getConfigsFromZipFile(zip)
    if (!configs) {
      throw new Error('Not found configs of api')
    }

    // APIの設定に基づいてlambdaを作成
    const createdLambdas = await createLambdaFunctions(bucketName, objectKey, branchName, configs)

    // 作成されたlambdaを元にAPI Gatewayを作成 すでに同じ名前のAPI Gatewayが存在していたら削除して再度作成する
    // await createApiGatewaysFromLambdas(createdLambdas, configs)

    // 完了をPipelineに通知
    await codepipeline.putJobSuccessResult({ jobId }).promise()
  } catch (e) {
    await codepipeline
      .putJobFailureResult({ jobId, failureDetails: { message: JSON.stringify(e), type: 'JobFailed' } })
      .promise()
    console.log(e)
  }
}

const getConfigsFromZipFile = (zipFile: AdmZip, target: string = 'config.json'): APIConfigData[] | null => {
  const buffer = zipFile
    .getEntries()
    .filter((value) => value.name === target)[0]
    ?.getData()
  if (!buffer) return null

  return JSON.parse(buffer.toString('utf-8'))
}

const createLambdaFunctions = async (
  bucketName: string,
  zipKey: string,
  branchName: string,
  configs: APIConfigData[]
): Promise<Lambda.FunctionConfiguration[]> => {
  console.log(`start ${createLambdaFunctions.name}`)

  try {
    const lambdaCreatePromises = configs.map(async (config) => {
      const functionName = `${config.functionName}-${branchName}`

      const existFunction = await checkExistLambda(functionName)
      // すでに同名のLambdaが存在していたら削除する
      if (existFunction) {
        console.log('delete already exist function ')
        await lambda.deleteFunction({ FunctionName: functionName }).promise()
      }

      // 作成されるlambda用の権限を作成
      const roleArn = await createRoleForLambda(functionName, config.roles)
      console.log(`roleArn ${roleArn}`)

      return lambda
        .createFunction({
          Code: {
            S3Bucket: bucketName,
            S3Key: zipKey,
          },
          PackageType: 'Zip',
          FunctionName: functionName,
          Handler: config.handlerName,
          Role: roleArn,
          Runtime: 'nodejs18.x',
        })
        .promise()
    })

    return await Promise.all(lambdaCreatePromises)
  } catch (error) {
    console.log(`error at ${createLambdaFunctions.name} : ${error}`)
    throw error
  } finally {
    console.log(`end ${createLambdaFunctions.name}`)
  }
}

const createRoleForLambda = async (functionName: string, roleArns: string[]): Promise<string> => {
  console.log(`start ${createRoleForLambda.name}`)

  // lambdaに対する信頼ポリシー
  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: 'lambda.amazonaws.com',
        },
        Action: 'sts:AssumeRole',
      },
    ],
  }

  const roleName = `roleFor${functionName}`
  const params = {
    AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
    RoleName: roleName,
  }

  try {
    let role: IAM.Role

    const existRole = await checkExistRole(roleName)
    // Roleが既に存在していたらアタッチされてるポリシー全て外す
    if (existRole) {
      const policies = await iam.listAttachedRolePolicies({ RoleName: roleName }).promise()
      const promises = policies.AttachedPolicies?.map((policy) =>
        iam.detachRolePolicy({ RoleName: roleName, PolicyArn: policy.PolicyArn ?? '' }).promise()
      )
      await Promise.all(promises ?? [])

      role = existRole
    } else {
      role = (await iam.createRole(params).promise()).Role
    }

    console.log(`attach policy to role ${role.RoleName} ${role.Arn}`)
    const promises = roleArns.map((arn) => {
      return iam
        .attachRolePolicy({
          RoleName: role.RoleName,
          PolicyArn: arn,
        })
        .promise()
    })
    await Promise.all(promises)
    console.log('success attach policies to created role')

    return role.Arn
  } catch (e) {
    console.log(`error at ${createRoleForLambda.name} error: ${e}`)
    throw e
  } finally {
    console.log(`end ${createRoleForLambda.name}`)
  }
}

// TODO 既に同名のAPIが存在していたらどうなる？
const createApiGatewaysFromLambdas = async (
  lambdaConfigs: Lambda.FunctionConfiguration[],
  configs: APIConfigData[]
): Promise<void> => {
  console.log(`start ${createApiGatewaysFromLambdas.name}`)

  const create = async (lambdaConfig: Lambda.FunctionConfiguration) => {
    // apiを作成
    const apiParams: APIGateway.CreateRestApiRequest = {
      name: `api-${lambdaConfig.FunctionName}` ?? '',
    }
    const apiResult = await apigateway.createRestApi(apiParams).promise()
    const apiId = apiResult.id
    if (!apiId) {
      throw new Error('Not found api id')
    }

    const apiConfig = configs.filter((config) => config.handlerName == lambdaConfig.Handler)[0]
    console.log(`apiConfig ${apiConfig}`)

    // apiのリソースを作成
    const apiResourceParams: APIGateway.CreateResourceRequest = {
      restApiId: apiId,
      parentId: apiResult.rootResourceId ?? '',
      pathPart: apiConfig.functionName,
    }
    const resourceResult = await apigateway.createResource(apiResourceParams).promise()
    const apiResourceId = resourceResult.id
    if (!apiResourceId) {
      throw new Error('Not found api resource id')
    }

    // メソッドを作成
    const methodParams: APIGateway.PutMethodRequest = {
      restApiId: apiId,
      resourceId: apiResourceId,
      httpMethod: apiConfig.method,
      authorizationType: 'NONE',
    }
    await apigateway.putMethod(methodParams).promise()

    // APIにリクエストが来た時にそれをLambdaに連携するための設定
    const integrationParams = {
      restApiId: apiId,
      resourceId: apiResourceId,
      httpMethod: apiConfig.method,
      type: 'AWS_PROXY',
      // API GatewayからLambda関数にリクエストを転送する際に使用されるHTTPメソッド
      integrationHttpMethod: apiConfig.method,
      uri: lambdaConfig.FunctionArn,
    }
    await apigateway.putIntegration(integrationParams).promise()
  }

  try {
    await Promise.all(lambdaConfigs.map((config) => create(config)))
    console.log('success api from lambda')
  } catch (error) {
    console.log(`error at ${createApiGatewaysFromLambdas.name} : ${error}`)
    throw error
  } finally {
    console.log(`end ${createApiGatewaysFromLambdas.name}`)
  }
}

const checkExistRole = async (roleName: string): Promise<IAM.Role | null> => {
  console.log(`start ${checkExistRole.name}`)

  try {
    return (await iam.getRole({ RoleName: roleName }).promise()).Role
  } catch (error: any) {
    console.log(`error at ${checkExistRole.name} ${error}`)
    if ('code' in error && error.code === 'NoSuchEntity') {
      return null
    }
    throw error
  } finally {
    console.log(`end ${checkExistRole.name}`)
  }
}

const checkExistLambda = async (functionName: string): Promise<string | null> => {
  console.log(`start ${checkExistLambda.name}`)

  try {
    await lambda.getFunction({ FunctionName: functionName }).promise()

    return functionName
  } catch (error: any) {
    console.log(`error at ${checkExistLambda.name} ${error}`)
    if ('code' in error && error.code === 'ResourceNotFoundException') {
      return null
    }
    throw error
  } finally {
    console.log(`end ${checkExistLambda.name}`)
  }
}

type APIConfigData = {
  functionName: string
  handlerName: string
  method: string
  roles: string[]
}
