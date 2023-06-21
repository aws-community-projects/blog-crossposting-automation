import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secrets = new SecretsManagerClient({});
let cachedSecrets: Record<string, string> = {};

export const getSecret = async (secretKey: string): Promise<string> => {
  if (cachedSecrets[secretKey]) {
    return cachedSecrets[secretKey];
  } else {
    const secretResponse = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ID }));
    if (secretResponse && secretResponse.SecretString) {
      cachedSecrets = JSON.parse(secretResponse.SecretString);
      return cachedSecrets[secretKey];
    }
    throw new Error("No data in secret");
  }
};