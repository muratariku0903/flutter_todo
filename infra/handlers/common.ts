import { CloudFormation, SSM, SecretsManager } from 'aws-sdk'

const cloudformation = new CloudFormation()
const ssm = new SSM()
const secretsManager = new SecretsManager()

export const getValueFromParameterStore = async (key: string): Promise<string> => {
  console.log(`start ${getValueFromParameterStore.name} key: ${key}`)

  try {
    const res = await ssm.getParameter({ Name: key, WithDecryption: true }).promise()
    console.log(`value : ${res.Parameter?.Value}`)

    const value = res.Parameter?.Value
    if (!value) {
      throw new Error(`fail fetch value from parameter store key: ${key}`)
    }

    return value
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getValueFromParameterStore.name}`)
  }
}

export const getValueFromStackOutputByKey = async (stackName: string, key: string): Promise<string> => {
  console.log(`start ${getValueFromStackOutputByKey.name} stackName: ${stackName} key: ${key}`)

  try {
    const exportedOutputKey = key
    const stack = await cloudformation.describeStacks({ StackName: stackName }).promise()

    if (!stack || stack.Stacks?.length === 0 || !stack!.Stacks![0].Outputs) {
      throw new Error(`undefined stack outputs key: ${key}`)
    }

    const outputs = stack.Stacks![0].Outputs
    console.log(`outputs: ${outputs}`)
    const output = outputs.find((o) => o.OutputKey === exportedOutputKey)
    if (!output) {
      throw new Error(`undefined stack output key: ${key}`)
    }

    const value = output.OutputValue
    console.log(`output value : ${value}`)

    if (!value) {
      throw new Error(`undefined value from output key: ${key}`)
    }

    return value
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getValueFromStackOutputByKey.name}`)
  }
}

export const getValueFromSecretManager = async (secretName: string, keyName: string): Promise<string> => {
  console.log(`start ${getValueFromSecretManager.name} secretName: ${secretName} keyName: ${keyName}`)

  try {
    const res = await secretsManager.getSecretValue({ SecretId: secretName }).promise()
    if (!res || !res.SecretString) {
      throw new Error('undefined Secret data')
    }

    const value = JSON.parse(res.SecretString)[keyName] as string
    if (!value) {
      throw new Error(`undefined Secret data secretName: ${secretName}, keyName: ${keyName}`)
    }

    console.log(`secret value: ${value}`)

    return value
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    console.log(`end ${getValueFromSecretManager.name}`)
  }
}
