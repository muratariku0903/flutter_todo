// import * as cdk from 'aws-cdk-lib'
// import { Construct } from 'constructs'
// import * as s3 from 'aws-cdk-lib/aws-s3'
// import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
// import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
// import * as codebuild from 'aws-cdk-lib/aws-codebuild'
// import * as codepipeline from 'aws-cdk-lib/aws-codepipeline'
// import * as codepipelineActions from 'aws-cdk-lib/aws-codepipeline-actions'
// import * as iam from 'aws-cdk-lib/aws-iam'

// // 各ブランチに対応したPipelineStackを自動作成するためのStack
// export class CreatePipelineStack extends cdk.Stack {
//   constructor(scope: Construct, id: string, props?: cdk.StackProps) {
//     super(scope, id, props)

//     const branchName = process.env.BRANCH_NAME
//     console.log(branchName)

//     const now = new Date()

//     const project = new codebuild.Project(this, `todoBuildProjectIdOf${branchName}`, {
//       buildSpec: codebuild.BuildSpec.fromObject({
//         version: '0.2',
//         phases: {
//           pre_build: {
//             commands: [
//               `echo Pre Build for branch: ${branchName} started on ${now.toISOString()}`,
//               // always install latest stable version flutter
//               'git clone https://github.com/flutter/flutter.git -b stable',
//               'export PATH="$PATH:`pwd`/flutter/bin"',
//               'flutter precache',
//               'flutter doctor',
//             ],
//           },
//           build: {
//             commands: [
//               `echo Build for branch: ${branchName} started on ${now.toISOString()}`,
//               'flutter clean',
//               'flutter pub get',
//               'flutter pub run build_runner build',
//               'flutter build web',
//             ],
//           },
//         },
//         artifacts: {
//           // store of created artifacts
//           'base-directory': 'build/web',
//           files: ['**/*'],
//         },
//       }),
//     })

//     const sourceOutput = new codepipeline.Artifact()
//     const buildOutput = new codepipeline.Artifact()

//     const githubSourceAction = new codepipelineActions.GitHubSourceAction({
//       actionName: 'Github',
//       owner: 'muratariku0903',
//       repo: 'flutter_todo',
//       // branch: branchName,
//       // refer to Github token stored in AWS Secret Manager, this token is used to AWS accessing to Github
//       oauthToken: cdk.SecretValue.secretsManager('github-pipeline-token', { jsonField: 'github-token' }),
//       // source code is stored in to sourceOutput as artifact and send to next stage of 'Build'
//       output: sourceOutput,
//     })

//     // const branchName = githubSourceAction.variables.branchName
//     // console.log(branchName)

//     // pipeline
//     const pipeline = new codepipeline.Pipeline(this, `todoPipelineIdOf${branchName}`, {
//       stages: [
//         {
//           stageName: 'Source',
//           actions: [githubSourceAction],
//         },
//         {
//           stageName: 'Build',
//           actions: [
//             new codepipelineActions.CodeBuildAction({
//               actionName: 'CodeBuild',
//               project,
//               input: sourceOutput,
//               // builded source code is stored in to buildOutput as artifact and send to next stage of 'Deploy'
//               outputs: [buildOutput],
//             }),
//           ],
//         },
//         {
//           stageName: 'Deploy',
//           actions: [
//             new codepipelineActions.S3DeployAction({
//               actionName: 'Deploy',
//               input: buildOutput,
//               // refer from common service stack
//               bucket: bucket,
//             }),
//           ],
//         },
//       ],
//     })

//     // grant permissions to invalidate CloudFront cache
//     const invalidatePermission = new iam.PolicyStatement({
//       actions: ['cloudfront:CreateInvalidation'],
//       resources: ['*'],
//       effect: iam.Effect.ALLOW,
//     })
//     pipeline.addToRolePolicy(invalidatePermission)

//     // deploy flutter build file
//     // using lambda function, upload artifact file stored in /build/web to s3 each branch
//     // new s3deploy.BucketDeployment(this, 'todoDeployId', {
//     //   sources: [s3deploy.Source.asset('../build/web')],
//     //   //
//     //   destinationBucket: bucket,
//     //   distribution: distribution,
//     //   destinationKeyPrefix: branchName,
//     //   distributionPaths: [`/${branchName}/*`],
//     // })
//   }
// }
