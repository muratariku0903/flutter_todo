#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CommonServiceStack } from '../lib/common-service-stack'
import { GithubTriggerStack } from '../lib/github-trigger-stack'
import { DeploymentsStack } from '../lib/deployments-stack'
import { deploymentsConfig } from '../lib/deployments-config'

const app = new cdk.App()

// CodeBuildの環境変数でブランチを指定してある
const branchName = process.env.BRANCH_NAME || 'master'

new CommonServiceStack(app, 'CommonServiceStack')
new GithubTriggerStack(app, 'GithubTriggerStack')
new DeploymentsStack(app, `DeploymentsStack-${branchName}`, { branchName, deploymentConfig: deploymentsConfig })
