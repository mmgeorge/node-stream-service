import fetch from "node-fetch";

interface IHandshakeMessage {
  format: "json";
  spatialReference: {
    wkid: number
  },
  outFields?: string[]
}

interface PointFeature {
  attributes: { [key: string]: string | number },
  geometry: {
    x: number,
    y: number;
  }
}

interface PolygonFeature {
  attributes: { [key: string]: string | number },
  geometry: {
    rings: number[][][]
  }
}

let ID_COUNTER = 0x1;
let PAGE = 0;

const config = {
  trackedAssets: 24000,
  updateInterval: 50,
  pageSize: 8000,
  distStep: 0.05 * 3,
  extrudePolygons: false,
}


const lastObservations: PointFeature[] = []
const vertexPositions: number[] = [];


function sumPolylineVertices(highways: FeatureSet<Polyline>, features: Feature<Polyline>[]): number {
  let sum = 0;
  
  for (const feature of highways.features) {
    const paths = feature.geometry.paths;

    for (const path of paths) {
      sum += path.length;
    }
  }

  console.log("VertexCount:", sum);

  return sum;
}


function initializeObersvations(highways: FeatureSet<Polyline>): void {
  const vertexSum = sumPolylineVertices(highways, highways.features);
  const vertsPerAsset = vertexSum / config.trackedAssets;

  let vertexPos = 0;

  for (let featureIndex = 0; featureIndex < highways.features.length; featureIndex++) {
    const feature = highways.features[featureIndex];
    const paths = feature.geometry.paths;

    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];

      for (let vertPos = 0; vertPos < (path.length - 1); vertPos += vertsPerAsset) {
        const vertIndex = Math.floor(vertexPos);
        const dist = vertexPos - vertIndex;

        vertexPositions.push(featureIndex);
        vertexPositions.push(pathIndex);
        vertexPositions.push(vertIndex);
        vertexPositions.push(dist);
      }
    }
  }


  for (let i = 0; i < vertexPositions.length; i += 4) {
    const featureIndex = vertexPositions[i]
    const pathIndex = vertexPositions[i + 1]
    const vertIndex = vertexPositions[i + 2]
    const dist = vertexPositions[i + 3]
    const paths = highways.features[featureIndex].geometry.paths;
    const vertex = paths[pathIndex][vertIndex];
    const vertexNext = paths[pathIndex][vertIndex + 1];
    const x0 = vertex[0];
    const y0 = vertex[1];
    const x1 = vertexNext[0];
    const y1 = vertexNext[1];
    const x = x0 + (x1 - x0) * dist;
    const y = y0 + (y1 - y0) * dist;
    
    lastObservations.push({
      attributes: {
        OBJECTID: createId(),
        TRACKID: i / 4,
      },
      geometry: { x, y }
    })
  }
}

function updatePositions(highways: FeatureSet<Polyline>): void {
  for (let i = 0; i < vertexPositions.length; i += 4) {
    const featureIndex = vertexPositions[i]
    const pathIndex = vertexPositions[i + 1]

    let vertIndex = vertexPositions[i + 2]

    const dist = vertexPositions[i + 3]
    const paths = highways.features[featureIndex].geometry.paths;

    if (!paths[pathIndex]) {
      return;  
    }
    
    const vertex = paths[pathIndex][vertIndex];
    const vertexNext = paths[pathIndex][vertIndex + 1];
    const x0 = vertex[0];
    const y0 = vertex[1];
    const x1 = vertexNext[0];
    const y1 = vertexNext[1];
    const x = x0 + (x1 - x0) * dist;
    const y = y0 + (y1 - y0) * dist;
    const index = i / 4;
    
    const geometry = lastObservations[index].geometry;
    const attributes = lastObservations[index].attributes;

    attributes.OBJECTID = createId(); // New observation needs new oid
    
    geometry.x = x;
    geometry.y = y;

    let nextDist = dist + config.distStep;
    
    if (nextDist >= 1.0) {
      // Move to nexxt vertex
      nextDist = 0;
      vertIndex += 1;

      // If we reach the end, loop back ground
      if (vertIndex >= (paths[pathIndex].length - 1))  {
        vertIndex = 0;
      }
    }

    vertexPositions[i + 2] = vertIndex;
    vertexPositions[i + 3] = nextDist

  }
}



function nextPage () {
  PAGE++;
  
  const maxPage = Math.ceil(config.trackedAssets / config.pageSize);

  if (PAGE >= maxPage) {
    PAGE = 0;
  }

  return PAGE;
}


function extrudePolygon(feature: PointFeature): PolygonFeature {
  // Create a quad
  const width = 2500;
  const x = feature.geometry.x;
  const y = feature.geometry.y;
  
  return {
    attributes: feature.attributes,
    geometry: {
      rings: [
        [
          [x - width, y + width],
          [x + width, y + width],
          [x + width, y - width],
          [x - width, y - width],
          [x - width, y + width]
        ]
      ]
    }
  }
  
}


export async function initFeatureSet(): Promise<FeatureSet<Polyline>> {
  const highways = await fetchHighways();

  initializeObersvations(highways);

  return highways;
}


export function createFeatureMessage(highways: FeatureSet<Polyline>): string {
  const outFeatures: (PointFeature | PolygonFeature)[] = [];
  const start = nextPage() * config.pageSize;
  const end = Math.min(start + config.pageSize, config.trackedAssets);
   
  if (start === 0) {
    updatePositions(highways);
  }
 
  for (let i = start; i < end; i++) {
    const feature = lastObservations[i];

    if (config.extrudePolygons) {
      outFeatures.push(extrudePolygon(feature));  
    } else {
      outFeatures.push(feature);  
    }
  }

  return JSON.stringify({
    type: "featureResult",
    features: outFeatures
  });
}


function createId(): number {
  const id = ID_COUNTER;
  
  ID_COUNTER = ((ID_COUNTER + 1) % 0xfffffffe); // force nonzero u32
  return id;
}

function createFeature(highways: FeatureSet<Polyline>): PointFeature {
  const featureIndex = Math.floor(Math.random() * (highways.features.length - 1));
  const feature = highways.features[featureIndex];
  const pathIndex = Math.floor(Math.random() * (feature.geometry.paths.length - 1));
  const path = feature.geometry.paths[pathIndex];
  const vertexIndex = Math.floor(Math.random() * (path.length - 1));
  const vertex = path[vertexIndex];
  const [x, y] = vertex;
  
  return {
    attributes: {
      OBJECTID: createId(),
    },
    geometry: {
      x, //: Math.random() * 360 - 180,
      y, //: Math.random() * 180 - 90,
    }
  }
}

interface Feature<T> {
  attributes: { [key: string]: string | number },
  geometry: T;
}

interface Polyline {
  paths: number[][][];
}


interface FeatureSet<T> {
  features: Feature<T>[];
}

async function fetchHighways (): Promise<FeatureSet<Polyline>> {
  const response = await fetch("https://www.usda.gov/giseas1/rest/services/BioRefineryTool/DemandInfrastructure_IdentifyLayers/MapServer/9/query?where=1%3D1&text=&objectIds=&time=&geometry=&geometryType=esriGeometryEnvelope&inSR=&spatialRel=esriSpatialRelIntersects&relationParam=&outFields=&returnGeometry=true&returnTrueCurves=false&maxAllowableOffset=&geometryPrecision=&outSR=&having=&returnIdsOnly=false&returnCountOnly=false&orderByFields=&groupByFieldsForStatistics=&outStatistics=&returnZ=false&returnM=false&gdbVersion=&historicMoment=&returnDistinctValues=false&resultOffset=&resultRecordCount=&queryByDistance=&returnExtentOnly=false&datumTransformation=&parameterValues=&rangeValues=&quantizationParameters=&featureEncoding=esriDefault&f=json");

  return response.json() as Promise<FeatureSet<Polyline>>;
}

