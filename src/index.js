// Import node modules.
import BodyParser from 'body-parser';
import Cryptr from 'cryptr';
import Express from 'express';
import FileAsync from 'lowdb/adapters/FileAsync';
import LodashId from 'lodash-id';
import LowDB from 'lowdb';
import Morgan from 'morgan';
import Path from 'path';
import _ from 'lodash';

// Import additional modules.
import { API_CONFIG, DB_CONFIG } from './config';
import API from './api';
import Middleware from './middleware';
import { responseBuilder, getTotalCollections } from './helpers';

// Create server object.
// Configure server with middleware to parse JSON objects and URL parameters.
const Server = new Express();
Server.use(Morgan(API_CONFIG.MORGAN));
Server.use(BodyParser.json());
Server.use(
  BodyParser.urlencoded({
    extended: true
  })
);

// Create a key and encryption object.
const Key = new Cryptr(DB_CONFIG.SECRET);
const Encryption = {
  serialize: data => Key.encrypt(JSON.stringify(data)),
  deserialize: data => JSON.parse(Key.decrypt(data))
};

// Track progress of collections being loaded successfully.
let inMemory = 0;
let inFileSystem = 0;

// Parse through the configuration for the database to generate each collection and it's API.
_.forEach(DB_CONFIG.COLLECTIONS, element => {
  _.forEach(element, (object, key) => {
    // Create new adapter for LowDB to read/write.
    // Encrypt/decrypt corresponding collection file.
    const Adapter = new FileAsync(`${DB_CONFIG.LOCATION}/${key}.json`, Encryption);

    // Use adapter for LowDB instance.
    // Set defaults and write new collection file if none exists.
    // Load collection into memory.
    LowDB(Adapter)
      .then(Collection => {
        Collection.defaults(element)
          .write()
          .then(() => {
            inFileSystem += 1;

            // Generate CRUD API routes for this collection.
            API(Server, Collection);
          })
          .catch(error => {
            throw new Error(error);
          });

        // Attach middleware functions to LowDB instance.
        Collection._.mixin(LodashId);
        Collection._.mixin(Middleware);
      })
      .then(() => {
        inMemory += 1;
      })
      .catch(error => {
        throw new Error(error);
      });
  });
});

Server.get('/', (request, response) => {
  response.sendFile(Path.join(__dirname, './public/index.html'));
});

// Poll until collections have all been loaded in memory and saved to the file system.
// When ready, start Express server and listen to requests.
// Kill loop when all good.
const CollectionsReady = setInterval(() => {
  if (inMemory + inFileSystem === getTotalCollections(DB_CONFIG.COLLECTIONS) * 2) {
    // Handle 404's and 500's.
    // These have to be defined here after all the promises have executed and collections with their endpoints loaded.
    Server.use((request, response) => {
      response.status(404).send(responseBuilder(404, request, {}, { error: 'not found' }));
    });
    Server.use((error, request, response) =>
      response.status(500).send(responseBuilder(500, request, {}, error))
    );

    // Start listening on configured port.
    Server.listen(API_CONFIG.PORT, () => {
      process.stdout.write(`${API_CONFIG.NAME} is now listening on port ${API_CONFIG.PORT}\n`);
    });

    clearInterval(CollectionsReady);
  }
}, 1000 / 100);
