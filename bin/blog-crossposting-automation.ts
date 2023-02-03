#!/usr/bin/env node
import 'source-map-support/register';
import { BlogCrosspostingAutomationStack } from '../lib/blog-crossposting-automation-stack';
import { App } from 'aws-cdk-lib';

const app = new App();
new BlogCrosspostingAutomationStack(app, 'BlogCrosspostingAutomationStack', {
  githubOwner: '',
  githubRepo: '',
  amplifyProjectId: '',
  mediumPublicationId: '',
  mediumAuthorId: '',
  devOrganizationId: '',
  hashnodePublicationId: '',
  hashnodeBlogUrl: '',
  blogBaseUrl: '',
  blogContentPath: '',
  notificationEmail: '',
  sendgridFromEmail: '',
});