export const getTweets = (postContent: string) => {
  const tweetMatches = postContent.matchAll(
    /\{\{<tweet user="([a-zA-Z0-9]*)" id="([\d]*)">\}\}/g
  );
  return tweetMatches;
};