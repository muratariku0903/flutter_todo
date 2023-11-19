import { CloudFormation, SSM, SecretsManager, SES } from 'aws-sdk'

const cloudformation = new CloudFormation()
const ssm = new SSM()
const secretsManager = new SecretsManager()
const ses = new SES()

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

export const sendEmail = async (emails: string[], subject: string, body: string, source?: string): Promise<void> => {
  console.log(`start ${sendEmail.name} email: ${emails}`)

  try {
    if (!source) {
      source = await getValueFromParameterStore('source_email')
    }

    // メールの設定
    const emailParams = {
      Source: source, // 承認されたメールアドレス
      Destination: {
        ToAddresses: emails,
      },
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: body },
        },
      },
    }

    await ses.sendEmail(emailParams).promise()
    console.log(`Success send email to ${emails.join(' ')}`)
  } catch (e) {
    // メール送信に失敗しても例外はスローしない
    console.log(`Fail send email to ${emails.join(' ')} error: ${JSON.stringify(e)}`)
  } finally {
    console.log(`end ${sendEmail.name}`)
  }
}

export const notifyAllMembers = async (subject: string, body: string): Promise<void> => {
  console.log(`start ${notifyAllMembers.name}`)

  try {
    // 開発メンバーのメールアドレスを取得
    const param = await getValueFromParameterStore('')
    const emails = param.split(',')

    await sendEmail(emails, subject, body)
    console.log(`Success send email to ${emails.join(',')}`)
  } catch (e) {
    // メール送信に失敗しても例外はスローしない
    console.log(`Fail send email error: ${JSON.stringify(e)}`)
  } finally {
    console.log(`end ${notifyAllMembers.name}`)
  }
}

type NotifyType = 'SUCCESS' | 'FAIL'
