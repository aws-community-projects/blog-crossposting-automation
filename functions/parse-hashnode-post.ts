import { getLinks } from "./utils/getLinks";
import { getTweets } from "./utils/getTweets";
import { getTweetUrl } from "./utils/getTweetUrl";

const frontmatter = require("@github-docs/frontmatter");

export const handler = async (state: {
  post: any;
  format: string;
  articleCatalog: any;
  canonical?: string;
}) => {
  const details = frontmatter(state.post);
  const links = getLinks(details.content);
  const tweets = getTweets(details.content);

  const payload = formatHashnodeData(
    details,
    state.articleCatalog,
    links,
    tweets
  );

  return {
    payload,
    url: `/${details.data.slug.replace(/^\/|\/$/g, "")}`,
  };
};

const formatHashnodeData = (
  postDetail: {
    content: string;
    data: { title: any; image: any; slug: string; description: any };
  },
  articleCatalog: any[],
  links: any,
  tweets: any
) => {
  let hashnodeContent = postDetail.content.slice(0);
  for (const link of links) {
    const replacement = articleCatalog.find((c) => c.links.M.url.S == link[1]);
    if (replacement) {
      if (
        replacement.links.M.hashnodeUrl &&
        replacement.links.M.hashnodeUrl.S
      ) {
        hashnodeContent = hashnodeContent.replace(
          link[1],
          replacement.links.M.hashnodeUrl.S
        );
      } else {
        hashnodeContent = hashnodeContent.replace(
          link[1],
          `${process.env.AMPLIFY_BASE_URL}${replacement.links.M.url.S}`
        );
      }
    }
  }

  for (const tweet of tweets) {
    const tweetUrl = getTweetUrl(tweet);
    hashnodeContent = hashnodeContent.replace(tweet[0], `%[${tweetUrl}]`);
  }

  const hashnodeData = {
    query:
      "mutation createPublicationStory($input: CreateStoryInput!, $publicationId: String!){ createPublicationStory( input: $input, publicationId: $publicationId ){ code success message post { slug }} }",
    variables: {
      publicationId: process.env.HASHNODE_PUBLICATION_ID,
      input: {
        title: postDetail.data.title,
        contentMarkdown: hashnodeContent,
        coverImageURL: postDetail.data.image,
        ...(process.env.CANONICAL === "hashnode"
          ? {}
          : {
              isRepublished: {
                originalArticleURL: process.env.AMPLIFY_BASE_URL
                  ? `${
                      process.env.AMPLIFY_BASE_URL
                    }/${postDetail.data.slug.replace(/^\/|\/$/g, "")}`
                  : `${process.env.CANONICAL}`,
              },
            }),
        tags: [],
        subtitle: postDetail.data.description,
      },
    },
  };

  return hashnodeData;
};
