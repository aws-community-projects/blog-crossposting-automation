# Blog Crossposting Automation

Are you a blog writer? Hate cross-posting your content across the web? You're in luck! 

This solution will hook into your blog creation process and automatically cross-post your content for you to Medium, Dev.to, and Hashnode!

Deploy into your AWS account and type away!

For a full summary of this solution [please refer to this blog post](https://www.readysetcloud.io/blog/allen.helton/how-i-built-a-serverless-automation-to-cross-post-my-blogs/) by [Allen Helton](https://twitter.com/allenheltondev).

## Prerequisites

For cross-posts to work successfully, there are a few prereqs that must be met in your setup.

* Your blog post must be written in [markdown](https://en.wikipedia.org/wiki/Markdown).
* Content is checked into a repository in GitHub
* You have an application in [AWS Amplify](https://aws.amazon.com/amplify/) that has a runnable CI pipeline
* Blog posts have front matter in the format outlined in the [Blog Metadata](#blog-metadata) section

*Note - it is highly recommended you host your blog on your own site. This guarantees you own your content and prevents accidental loss if your favorite platform goes down or has an incident. It also enables [easy canonification](https://support.google.com/webmasters/answer/10347851) of your content when it is cross posted so it ranks higher in search engine results. For a step by step guide on hosting your own blog for free, please [reference this post](https://www.readysetcloud.io/blog/allen.helton/how-to-build-your-blog-with-aws-and-hugo/).*

## How It Works

![](/docs/workflow.png)

The cross posting process is outlined below.

1. Completed blog post written in markdown is committed to main branch
2. AWS Amplify CI pipeline picks up changes and runs build
3. On success, Amplify publishes a `Amplify Deployment Status Change` event to EventBridge, triggering a Lambda function deployed in this stack
4. The function uses your GitHub PAT to identify and load the blog post content and pass it into a Step Function workflow
5. The workflow will do an idempotency check, and if it's ok to continue will transform and publish to Medium, Hashnode, and Dev.to in parallel
6. After publish is complete, the workflow checks if there were any failures.
  * If there was a failure, it sends an email with a link to the execution for debugging
  * On success, it sends an email with links to the published content and updates the idempotency record and article catalog

*Note - If you do not provide a SendGrid API key, you will not receive email status updates*

## Platforms

This solution will take content you create and automatically cross-post it on three platforms:

* [Medium](https://medium.com) - *[generate API Key](https://help.medium.com/hc/en-us/articles/213480228-Get-an-integration-token-for-your-writing-app)*
* [Dev.to](https://dev.to) - *[generate API Key](https://dev.to/settings/extensions)*
* [Hashnode](https://hashnode.com) - *[generate API Key](https://hashnode.com/settings/developer)*

You are required to have an account on all three platforms and must generate an API key for each of them. 

Optionally, you can publish straight to publications on each of the platforms. If there is a specific organization on Dev.to or publication on Medium or Hashnode you typically write for, you can fill out `DevOrganizationId`, `MediumPublicationId`, and `HashnodePublicationId` deployment variables respectively. For example, you could automatically submit your story to the [AWS Community Builders](https://dev.to/aws-builders) organization on dev.to instead of under your name.

## Deployment

The solution is built using AWS SAM. To deploy the resources into the cloud you must install the [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

Once installed, run the following commands in the root folder of the solution.

```bash
sam build --parallel
sam deploy --guided
```

This will walk you through deployment, prompting you for all the parameters necessary for proper use. Below are the parameters you must fill out on deploy.

|Parameter|Description|Required|
|---------|-----------|--------|
|TableName|Name of the DynamoDB table to create|No|
|GSI1|Name of the GSI on the DDB table|No|
|GitHubPAT|Personal Access Token to load newsletter content from your repository|Yes|
|GitHubOwner|The GitHub user name that owns the repository for your content|Yes|
|GitHubRepo|The repository name that contains your content|Yes|
|AmplifyProjectId|Identifier of the Amplify project that builds your newsletter|Yes|
|MediumApiKey|API key used to manipulate data in your Medium account|Yes|
|MediumPublicationId|Identifier of the publication you wish to submit to on Medium|No|
|MediumAuthorId|Identifier of your user on Medium|Yes if `MediumPublicationId` is not provided|
|DevApiKey|API key used to manipulate data in your Dev.to account|Yes|
|DevOrganizationId|Identifier of the organization you wish to submit to on Dev.to|No|
|HashnodeApiKey|API key used to manipulate data in your Hashnode account|Yes|
|HashnodePublicationId|Identifier for your blog publication on Hashnode|Yes|
|HashnodeBlogUrl|Base url of your blog hosted in Hashnode|Yes|
|BlogBaseUrl|Vase url of your blog on your personal site|Yes|
|BlogContentPath|Relative path from the root directory to the blog content folder in your GitHub repo|Yes|
|SendgridApiKey|Api Key of the SendGrid account that will send the status report when cross-posting is complete|No|
|NotificationEmail|Email address to notify when cross posting is complete|No|
|SendgridFromEmail|Email address for SendGrid that sends you the status email|No|

## Notification Emails

If you wish to get notification emails on the status of the cross posting, you must use [SendGrid](https://sendgrid.com). SendGrid offers a generous free tier for email messages and is quick to get started. To configure SendGrid to send you emails you must:

* [Create an API key](https://docs.sendgrid.com/ui/account-and-settings/api-keys)
* [Create a sender](https://docs.sendgrid.com/ui/sending-email/senders)

Once you perform the above actions, you may use the values in the respective deployment variables listed above.

## Replay / Idempotency

In the event the cross-posting does not work, it can be safely retried without worrying about pushing your content multiple times. Each post will update the idempotency DynamoDB record for the cross-posting state machine. This record holds the status (*success/failure*) for each platform. If the article was successfully posted on a platform, it will be skipped on subsequent executions.

## Blog Metadata

Your blog must be written in Markdown for this solution to work appropriately. To save metadata about your post, you can add [front matter](https://gohugo.io/content-management/front-matter/) at the beginning of the file. This solution requires a specific set of metadata in order to function appropriately.

**Example**
```yaml
---
title: My first blog!
description: This is the subtitle that is used for SEO and visible in Medium and Hashnode posts.
image: https://link-to-hero-image.png
image_attribution: Any attribution required for hero image
categories:
  - categoryOne
tags:
  - serverless
  - other tag
slug: /my-first-blog
---
```

|Field|Description|Required?|
|-----|-----------|---------|
|title|Title of the blog issue |Yes|
|description| Brief summary of article. This shows up on Hashnode and Medium and is used in SEO previews|Yes|
|image|Link to the hero image for your article|Yes|
|image_attribution|Any attribution text needed for your hero image|No|
|categories|Array of categories. This will be used as tags for Dev and Medium|No|
|tags|Array of tags. Also used as tags for Dev and Medium|No|
|slug|Relative url of your post. Used in the article catalog|Yes|

## Article Catalog

One of the neat features provided by this solution is substituting relative urls for the appropriate urls on a given page. For example, if you use a relative url to link to another blog post you've written on your site, this solution will replace that with the cross-posted version. So Medium articles will always point to Medium articles, Hashnode articles will always point to Hashnode, etc...

This is managed for you by the solution. It creates entries for your content in DynamoDB with the following format:

```json
{
  "pk": "<article slug>",
  "sk": "article",
  "GSI1PK": "article",
  "GSI1SK": "<title of the post>",
  "links": {
    "url": "<article slug>",
    "devUrl": "<full path to article on dev.to>",
    "mediumUrl": "<full path to article on Medium>",
    "hashnodeUrl": "<full path to article on Hashnode>"
  }
}
```

When transforming your Markdown content, it will load all articles from DynamoDB, use a Regex to match on the article slug in your content, and replace with the url of appropriate site.

If you already have a number of articles and wish to seed the database with the cross references, you will have to compile the data manually and put it in the following format:

```json
[
  {
    "title": "<title of article>",
    "devUrl": "<url of article on dev.to>",
    "url": "<relative url of article on your blog>",
    "mediumUrl": "<url of article on medium>",
    "hashnodeUrl": "<url of article on hashnode>"
  }
]
```

Take this data and update the [load-cross-posts](/functions/load-cross-posts/index.js) function to load and handle that data. Run the function manually to seed the data in your database table.

## Embeds

If you are embedding content in your posts, they might not work out of the box. *There is only support for Hugo twitter embeds.* The format of a Hugo Twitter embed is:

```
{{<tweet user="" id="">}}
```

If you include this in your content, it will be automatically transformed to the appropriate embed style on the appropriate platform.

## Limitations

Below are a list of known limitations:

* Your content must be written in Markdown with front matter describing the blog post.
* Content must be hosted in GitHub.
* You are required to post to Dev.to, Medium, and Hashnode. You cannot pick and choose which platforms you want to use.
* Only Hugo style Twitter embeds are supported. Embeds for other content will not work.
* This process is triggered on a successful build of an AWS Amplify project. Other triggers are not supported (but can easily be modified to add them).
* Notifications are limited to sending emails in SendGrid.
* The only way to deploy the solution is with AWS SAM.

## Contributions

Please feel free to contribute to this project! Bonus points if you can meaningfully address any of the limitations listed above :)

This is an AWS Community Builders project and is meant to help the community. If you see fit, please donate some time into making it better!
