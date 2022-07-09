![WeaverFi Banner][banner]

The API that powers WeaverFi.

![CodeQL](https://github.com/WeaverFi/api/actions/workflows/codeql-analysis.yml/badge.svg)
![Version](https://img.shields.io/github/package-json/v/WeaverFi/api)

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![Swagger](https://img.shields.io/badge/-Swagger-%23Clojure?style=for-the-badge&logo=swagger&logoColor=white)
![Firebase](https://img.shields.io/badge/firebase-%23039BE5.svg?style=for-the-badge&logo=firebase)

[<img src="https://img.shields.io/twitter/follow/weaver_fi?style=social" />](https://twitter.com/weaver_fi)

---

## Documentation

WeaverFi's OpenAPI documentation can be found [here](https://api.weaver.fi/docs).

---

## Contributing

Contribution guidelines can be found [here](CONTRIBUTING.md).

---

## Self-Hosting

This repository is already setup for Firebase hosting, but could easily be adapted to be deployed on AWS or any other cloud deployment service.

1. Add your own API keys in `functions/keys.json` (an example file is provided).

2. Install dependencies by navigating to the `functions` folder and using `npm i`.

3. To deploy to Firebase, add your project ID in `.firebaserc` (an example file is provided), and use `firebase deploy`.

[banner]: /Banner.png "WeaverFi"
