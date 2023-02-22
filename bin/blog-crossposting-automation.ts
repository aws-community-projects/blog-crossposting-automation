#!/usr/bin/env node
import 'source-map-support/register';
import { BlogCrosspostingAutomationStack, BlogCrosspostingAutomationStackProps } from '../lib/blog-crossposting-automation-stack';
import { App } from 'aws-cdk-lib';
import config from 'config';

const props: BlogCrosspostingAutomationStackProps = config.get('cdk');

const app = new App();
new BlogCrosspostingAutomationStack(app, 'BlogCrosspostingAutomationStack', {
  ...props,
});