import { PutItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient({});

export const handler = async () => {
  try {
    const data = getData();
    await Promise.allSettled(data.map(async (item) => {
      await addToDb(item);
    }));
  } catch (err) {
    console.error(err);
  }
};

const addToDb = async (item: { title: any; devUrl: any; url: any; mediumUrl: any; hashnodeUrl: any; }) => {
  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: item.url,
      sk: 'article',
      GSI1PK: 'article',
      GSI1SK: item.title,
      title: item.title,
      links: {
        url: item.url,
        ...item.devUrl && { devUrl: item.devUrl },
        ...item.mediumUrl && { mediumUrl: item.mediumUrl },
        ...item.hashnodeUrl && { hashnodeUrl: item.hashnodeUrl }
      }
    })
  }));
};

const getData = () => {
  return [
    {
      title: '<title of article>',
      devUrl: '<url of article on dev.to>',
      url: '<relative url of article on your blog>',
      mediumUrl: '<url of article on medium>',
      hashnodeUrl: '<url of article on hashnode>'
    }
  ]
};