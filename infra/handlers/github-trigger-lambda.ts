import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    let body = JSON.parse(event.body ?? '')
    console.log(body)

    let branchName = body.ref.split('/').pop()
    console.log('Branch Name:', branchName)

    console.log('hello!')

    return {
      statusCode: 200,
      body: JSON.stringify('Webhook received!'),
    }
  } catch (e) {
    console.error(e)

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'internal server error.' }),
    }
  }
}
