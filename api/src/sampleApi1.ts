import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

// TODO そもそもJSに変換しないとまずいのでは？
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('hello world api 1')

    return {
      statusCode: 200,
      body: 'success api1',
    }
  } catch (e) {
    console.error(e)

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'internal server error.' }),
    }
  }
}
