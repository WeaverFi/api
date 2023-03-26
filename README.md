![WeaverFi Banner][banner]

The API that powers WeaverFi.

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![Swagger](https://img.shields.io/badge/-Swagger-%23Clojure?style=for-the-badge&logo=swagger&logoColor=white)
![Firebase](https://img.shields.io/badge/firebase-%23039BE5.svg?style=for-the-badge&logo=firebase)

[<img src="https://img.shields.io/twitter/follow/weaver_fi?style=social" />](https://twitter.com/weaver_fi)

---

## API Usage

Learn more about our API and manage your API keys [here](https://api.weaver.fi).

WeaverFi's OpenAPI documentation can be found [here](https://api.weaver.fi/docs).

---

## Contributing

Contribution guidelines can be found [here](CONTRIBUTING.md).

---

## Firebase Deployment

This repository is already setup for Firebase hosting, but could easily be adapted to be deployed on any other cloud deployment service.

Currently the API also uses many other cloud functions to manage token prices, API key caching, etc. but those can be easily disabled.

1. Install dependencies by navigating to the `functions` folder and using `npm i`.

2. Add your project ID in `.firebaserc` (an example file is provided).

3. Change any settings to your liking in `index.ts`.

4. Optionally, whitelist any origins to be exempt from rate limits in `.env` (an example file is provided).

5. To deploy to Firebase, use `firebase deploy`.

Note: The API is currently configured through `getKeyInfo()` in `functions.ts` to only validate keys with a chain identifier appended to it. Modify that function if your implementation is different!

[banner]: /Banner.png "WeaverFi"
