#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CommonServiceStack } from '../lib/common-service-stack'
import { GithubTriggerStack } from '../lib/github-trigger-stack'
// import { PipelineStack } from '../lib/pipeline-stack'

const app = new cdk.App()

new CommonServiceStack(app, 'CommonServiceStack')
new GithubTriggerStack(app, 'GithubTriggerStack')
