export const deploymentsConfig: DeploymentConfig = {
  apiConfigs: [
    {
      functionName: 'sampleApi1',
      method: 'GET',
      roles: ['s3:ListBucket'],
    },
    {
      functionName: 'sampleApi2',
      method: 'POST',
      roles: ['s3:ListBucket'],
    },
  ],
}

export type DeploymentConfig = {
  apiConfigs: DeployApiConfig[]
}

type DeployApiConfig = {
  functionName: string
  method: HttpMethod
  roles: [string, ...string[]]
}

type HttpMethod = 'GET' | 'POST'
