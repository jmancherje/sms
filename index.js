const http = require("http");
const express = require("express");
const fetch = require("node-fetch");
const request = require("request");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const bodyParser = require("body-parser");

require("dotenv").load();

const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_TOKEN;
const client = require("twilio")(accountSid, authToken);
const MessagingResponse = require("twilio").twiml.MessagingResponse;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const peopleToNotify = process.env.NUMBERSTONOTIFY.split(',').filter(i => i);

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json"
};
var token;

const PORT = process.env.PORT || 1337;
const websiteId = "15d09dc1-c83d-4d55-ae61-0d555aaff267";
const imageComponentId = "448898fc-e676-4593-a6de-72501b1a07bf";
const titleContentId = "f119a592-182d-4637-90ad-6a94de0ea1bf";
const textBodyContentId = "b555d9e8-a3ec-4672-b559-293357171a58";
const phoneNumberContentId = 'ac1d5d2c-66a7-4fc8-b4d4-257df206a30d';

function handleImage(image, callback, textResponseNumbers = {}) {
  return request(image)
    .pipe(fs.createWriteStream("local.jpeg"))
    .on("close", () => {
      const form = new FormData();
      const path = `${__dirname}/local.jpeg`;
      form.append("file", fs.createReadStream(path), "image.jpeg");
      client.messages
        .create({
          body: 'Starting Image Upload...',
          ...textResponseNumbers,
        });
      return axios({
        method: "post",
        url: `https://app.brandcast.io/api/_/images/${websiteId}/upload/`,
        data: form,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${form._boundary}`,
          token
        }
      })
        .then((res) => {
          return fetch(`https://app.brandcast.io/api/_/content/${imageComponentId}`, {
            method: "PUT",
            body: JSON.stringify({
              type: "image",
              content: {
                image_id: res.data.image_id
              }
            }),
            headers: { ...headers, token }
          });
        })
        .then(res => res.json())
        .then(callback)
        .catch(err => console.error("error", err));
    });
}

function handleText(text, textContentId, type) {
  return fetch(`https://app.brandcast.io/api/_/content/${textContentId}`, {
    method: "PUT",
    body: JSON.stringify({
      type: "text",
      content: {
        blocks: [
          {
            text: text || ' ',
            element_type: "paragraph"
          }
        ]
      }
    }),
    headers: { ...headers, token }
  }).then(res => res.json());
}

function pollPublish(textResponseNumbers) {
  return new Promise((resolve, reject) => {
    function attemptPublish() {
      return fetch(
        `https://app.brandcast.io/api/_/sites/${websiteId}/publish/`,
        {
          method: "POST",
          headers: { token }
        }
      )
        .then(res => res.json())
        .then((res) => {
          if (res.url) {
            console.log("successful publish.");
            return resolve(res);
          }
          client.messages
            .create({
              body: 'Image still uploading, attemping to publish again in 5 seconds',
              ...textResponseNumbers,
            });
          setTimeout(attemptPublish, 5000);
        })
        .catch(err => reject(err));
    }
    return attemptPublish();
  });
}

function formatNumber(phoneNumber) {
  // converts +19258995970 to (925) 899-5970
  const part0 = phoneNumber.slice(2, 5);
  const part1 = phoneNumber.slice(5, 8);
  const part2 = phoneNumber.slice(8);
  return `(${part0}) ${part1}-${part2}`;
}

app.post("/sms", (req, res) => {
  const userNumber = req.body.From;
  const twilioNumber = req.body.To;
  const textResponseNumbers = {
    from: twilioNumber,
    to: userNumber,
  };
  const twiml = new MessagingResponse();

  peopleToNotify.forEach((number) => {
    client.messages
      .create({
        body: `${userNumber} is updating the site`,
        from: twilioNumber,
        to: number,
      });
  });

  const text = req.body.Body;
  const parts = text.split("\n").filter(x => x);
  const title = parts[0];
  const textBody = parts[1];
  const image = req.body.MediaUrl0;

  function handleTextAndPublish() {
    return handleText(title, titleContentId, 'title')
      .then(() => handleText(textBody, textBodyContentId, 'body'))
      .then(() => handleText(`Last udpated by: ${formatNumber(userNumber)}`, phoneNumberContentId, '‘edited by‘'))
      .then(() => pollPublish(textResponseNumbers))
      .then((res) => {
        const { url } = res;
        return client.messages
          .create({
            ...textResponseNumbers,
            body: `Website successfully updated. View it at: ${url}`,
          });
      })
      .catch(err => console.error(err));
  }

  if (!image) {
    handleTextAndPublish();
  } else {
    handleImage(image, handleTextAndPublish, textResponseNumbers);
  }
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

/**
 * This is just used to fetch and console.log the content
 */
function fetchAndLogContent() {
  fetch(`https://app.brandcast.io/api/_/sites/${websiteId}/content/`, {
    method: "GET",
    headers: { ...headers, token }
  })
    .then(res => res.json())
    .then(content => console.log('all website content: ', content))
    .catch(err => console.error("error", err));
}

function login() {
  const inputBody = {
    username: process.env.BRANDCAST_USERNAME,
    password: process.env.BRANDCAST_PASSWORD
  };

  fetch("https://app.brandcast.io/api/_/auth/", {
    method: "POST",
    body: JSON.stringify(inputBody),
    headers
  })
    .then(res => res.json())
    .then((body) => {
      console.log('successful brandcast login');
      token = body.token;
      fetchAndLogContent();
    });
}
login();

http.createServer(app).listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
});
