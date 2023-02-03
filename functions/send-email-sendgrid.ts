import * as sendgrid from '@sendgrid/mail';
import {EventBridgeEvent } from 'aws-lambda';
import { getSecret } from './utils/secrets';

export const handler = async (state: EventBridgeEvent<string, { to: string; subject: string; html: string; text: string; }>) => {
  try {
    const apiKey = await getSecret('sendgrid');
    sendgrid.setApiKey(apiKey);

    const { to, subject, html, text } = state.detail;
    await sendMessage(to, subject, html, text);
  } catch (err) {
    console.error(err);
  }
};

const sendMessage = async (to: string, subject: string, html: string, text: string) => {
  const msg = {
    to: to,
    from: process.env.FROM_EMAIL,
    subject: subject,
    ...html && {
      content: [
        {
          type: 'text/html',
          value: html
        }
      ]
    },
    ...text && { text: text }
  } as sendgrid.MailDataRequired;

  await sendgrid.send(msg);
};