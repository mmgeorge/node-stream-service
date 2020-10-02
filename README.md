This project provides simple nodejs example websocket server showing how to create a custom stream service that can interface with the ArcGIS 4.x Javascript API (4.17+). The underlying service tries to mock a routes stream by moving features along the polyline segments of a input polyline featureSet.

This code should only be viewed as a reference, and is not production ready. A real implementation should take care to better handle such things as malicious or slow clients, robust logging, and other issues that may arise in production. 

### Setup 
First verify that you are using nodejs 14.x.x: 
```
node -v
```

Install dependencies 
```
npm install
```

Now compile and run the server: 
```
npm start 
```

The server should now be running on port `8000`. Verify this by opening example.html. To use this, you will need to create a 4.17+ app with a StreamLayer that uses the new `websocketUrl` property pointing to `ws://localhost:8000`. Additionally you will need to specify the service's `objectIdField`, `trackIdField`, `fields`, and `geometryType` to make use of it. See example.html to see the metadata needed for this specific mock service. 


### Requirements for Custom Stream Services
When clients first connect to the custom websocket connection, the first message they send to the server will be a  handshake message with the following format: 

```ts
interface IHandshakeMessage {
  format: "json"; // currently only JSON is supported (over WebSocket text frames only)
  spatialReference: {
    wkid: number
  },
  outFields?: string[]
}
```

The server should then keep track of which properties have been requested by the client, and begin broadcasting events in the requested format. If the server cannot handled the required client configuration, it should close the connection. As for the structure of the broadcast events, they should consist of `featureResult` messages with the following format: 

```ts
interface FeatureResult {
  type: "featureResult";
  features: Feature[];  // Encoded in esriJSON
}
```

Due to the lack of metadata document, such metadata must be specified when the associated StreamLayer is created on the client (see example.html). 
