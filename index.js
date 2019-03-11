const http = require("http");
const https = require("https");
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

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json"
};
var token;
const websiteId = "15d09dc1-c83d-4d55-ae61-0d555aaff267";
// var pageId = "4cf26e13-e8a6-4a21-9148-0ef7354344d4";
const imageComponentId = "448898fc-e676-4593-a6de-72501b1a07bf";
const titleContentId = "f119a592-182d-4637-90ad-6a94de0ea1bf";
const textBodyContentId = "b555d9e8-a3ec-4672-b559-293357171a58";

function handleImage(image, callback) {
  console.log('has image')
  return request(image)
    .pipe(fs.createWriteStream("local.jpeg"))
    .on("close", () => {
      console.log('requesting image')
      const form = new FormData();
      const path = `${__dirname}/local.jpeg`;
      console.log('image path', path);
      form.append("file", fs.createReadStream(path), "image.jpeg");
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
          console.log("success", res.data.image_id);
          return fetch(
            `https://app.brandcast.io/api/_/content/${imageComponentId}`,
            {
              method: "PUT",
              body: JSON.stringify({
                type: "image",
                content: {
                  image_id: res.data.image_id
                }
              }),
              headers: { ...headers, token }
            }
          );
        })
        .then(res => res.json())
        .then(callback)
        .catch(err => console.error("error", err));
    });
}

function handleText(text, textContentId) {
  if (!text) return Promise.resolve();

  return fetch(`https://app.brandcast.io/api/_/content/${textContentId}`, {
    method: "PUT",
    body: JSON.stringify({
      type: "text",
      content: {
        blocks: [
          {
            text,
            element_type: "paragraph"
          }
        ]
      }
    }),
    headers: { ...headers, token }
  }).then(res => res.json());
}

function pollPublish() {
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
          setTimeout(attemptPublish, 10000);
        })
        .catch(err => reject(err));
    }
    return attemptPublish();
  });
}

app.post("/sms", (req, res) => {
  console.log('received sms', req)
  const userNumber = req.body.From;
  const twilioNumber = req.body.To;
  console.log('received a text from ', userNumber);
  const twiml = new MessagingResponse();

  const text = req.body.Body;
  const parts = text.split("\n").filter(x => x);
  const title = parts[0];
  const textBody = parts[1];
  const image = req.body.MediaUrl0;

  function handleTextAndPublish() {
    return handleText(title, titleContentId)
      .then(() => handleText(textBody, textBodyContentId))
      .then(pollPublish)
      .then((res) => {
        const { url } = res;
        return client.messages
          .create({
            body: `Website successfully updated. View it at: ${url}`,
            from: twilioNumber,
            to: userNumber
          });
      })
      .catch(err => console.error(err));
  }

  if (!image) {
    handleTextAndPublish();
  } else {
    handleImage(image, handleTextAndPublish);
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
      token = body.token;
      // fetchAndLogContent();
    });
}
login();

http.createServer(app).listen(1337, () => {
  console.log("Express server listening on port 1337");
});
