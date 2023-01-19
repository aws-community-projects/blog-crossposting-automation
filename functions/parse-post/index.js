const frontmatter = require('@github-docs/frontmatter');

exports.handler = async (state) => {
  const details = frontmatter(state.post);
  const links = getLinks(details.content);
  const tweets = getTweets(details.content);

  let payload;
  switch (state.format.toLowerCase()) {
    case 'medium':
      payload = formatMediumData(details, state.articleCatalog, links, tweets);
      break;
    case 'dev':
      payload = formatDevData(details, state.articleCatalog, links, tweets);
      break;
    case 'hashnode':
      payload = formatHashnodeData(details, state.articleCatalog, links, tweets);
      break;
  }
  return {
    payload,
    url: `/${postDetail.data.slug.replace(/^\/|\/$/g, '')}`
  };
};

const formatMediumData = (postDetail, articleCatalog, links, tweets) => {
  let mediumContent = `\n# ${postDetail.data.title}\n`
    + `#### ${postDetail.data.description}\n`
    + `![${postDetail.data.image_attribution ?? ''}](${postDetail.data.image})\n`
    + `${postDetail.content.slice(0)}`;

  for (const link of links) {
    const replacement = articleCatalog.find(c => c.links.M.url.S == link[1]);
    if (replacement) {
      if (replacement.links.M.mediumUrl && replacement.links.M.mediumUrl.S) {
        mediumContent = mediumContent.replace(link[1], replacement.links.M.mediumUrl.S);
      } else {
        mediumContent = mediumContent.replace(link[1], `${process.env.BLOG_BASE_URL}${replacement.links.M.url.S}`);
      }
    }
  }

  for (const tweet of tweets) {
    const tweetUrl = getTweetUrl(tweet);
    mediumContent = mediumContent.replace(tweet[0], tweetUrl);
  }

  const mediumData = {
    title: postDetail.data.title,
    contentFormat: 'markdown',
    tags: [...postDetail.data.categories, ...postDetail.data.tags],
    canonicalUrl: `${process.env.BLOG_BASE_URL}/${postDetail.data.slug.replace(/^\/|\/$/g, '')}`,
    publishStatus: 'draft',
    notifyFollowers: true,
    content: mediumContent
  };

  return mediumData;
};

const formatDevData = (postDetail, articleCatalog, links, tweets) => {
  let devContent = postDetail.content.slice(0);
  for (const link of links) {
    const replacement = articleCatalog.find(c => c.links.M.url.S == link[1]);
    if (replacement) {
      if (replacement.links.M.devUrl && replacement.links.M.devUrl.S) {
        devContent = devContent.replace(link[1], replacement.links.M.devUrl.S);
      } else {
        devContent = devContent.replace(link[1], `${process.env.BLOG_BASE_URL}${replacement.links.M.url.S}`);
      }
    }
  }

  for (const tweet of tweets) {
    const tweetUrl = getTweetUrl(tweet);
    devContent = devContent.replace(tweet[0], `{% twitter ${tweetUrl} %}`);
  }

  const devData = {
    title: postDetail.data.title,
    published: true,
    main_image: postDetail.data.image,
    canonical_url: `${process.env.BLOG_BASE_URL}/${postDetail.data.slug.replace(/^\/|\/$/g, '')}`,
    description: postDetail.data.description,
    tags: [...postDetail.data.categories.map(c => c.replace(/ /g, '')), ...postDetail.data.tags.map(t => t.toString().replace(/ /g, ''))],
    ...process.env.DEV_ORG_ID && { organization_id: process.env.DEV_ORG_ID },
    body_markdown: devContent
  };

  return { article: devData };
};

const formatHashnodeData = (postDetail, articleCatalog, links, tweets) => {
  let hashnodeContent = postDetail.content.slice(0);
  for (const link of links) {
    const replacement = articleCatalog.find(c => c.links.M.url.S == link[1]);
    if (replacement) {
      if (replacement.links.M.hashnodeUrl && replacement.links.M.hashnodeUrl.S) {
        hashnodeContent = hashnodeContent.replace(link[1], replacement.links.M.hashnodeUrl.S);
      } else {
        hashnodeContent = hashnodeContent.replace(link[1], `${process.env.BLOG_BASE_URL}${replacement.links.M.url.S}`);
      }
    }
  }

  for (const tweet of tweets) {
    const tweetUrl = getTweetUrl(tweet);
    hashnodeContent = hashnodeContent.replace(tweet[0], `%[${tweetUrl}]`);
  }

  const hashnodeData = {
    query: 'mutation createPublicationStory($input: CreateStoryInput!, $publicationId: String!){ createPublicationStory( input: $input, publicationId: $publicationId ){ code success message post { slug }} }',
    variables: {
      publicationId: process.env.HASHNODE_PUBLICATION_ID,
      input: {
        title: postDetail.data.title,
        contentMarkdown: hashnodeContent,
        coverImageURL: postDetail.data.image,
        isRepublished: {
          originalArticleURL: `${process.env.BLOG_BASE_URL}/${postDetail.data.slug.replace(/^\/|\/$/g, '')}`
        },
        tags: [],
        subtitle: postDetail.data.description
      },
    }
  }

  return hashnodeData;
};

const getLinks = (postContent) => {
  const linkMatches = postContent.matchAll(/\(([^\)]*)\)/g);
  return linkMatches;
};

const getTweets = (postContent) => {
  const tweetMatches = postContent.matchAll(/\{\{<tweet user="([a-zA-Z0-9]*)" id="([\d]*)">\}\}/g);
  return tweetMatches;
};

const getTweetUrl = (tweet) => {
  return `https://twitter.com/${tweet[1]}/status/${tweet[2]}`;
}