interface Feature<T> {
  attributes: { [key: string]: string | number },
  geometry: T;
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

export interface Polyline {
  paths: number[][][];
}

export interface FeatureSet<T> {
  features: Feature<T>[];
}

export interface MockServiceConfig {
  trackedAssets: number,
  pageSize: number,
  distStep: number,
  extrudePolygons: boolean
}


/** 
 * MockService that will output either point or polygon features with a geometry and 
 * two attributes - a TRACKID and OBJECTID
 */
export class MockService {
  constructor(config: Partial<MockServiceConfig>) {
    this._config = {...MockService._defaults(), ...config }
  };

  private static _defaults(): MockServiceConfig {
    return {
      trackedAssets: 24000,
      pageSize: 8000,
      distStep: 0.05 * 3,
      extrudePolygons: false,
    }
  }

  private _idCounter = 0x1;
  private _page = 0;
  private _config: MockServiceConfig
  private _lastObservations: PointFeature[] = [];
  private _vertexPositions: number[] = []
  private _polylines: FeatureSet<Polyline>

  initialize(polylines: FeatureSet<Polyline>): void {
    this._polylines = polylines;
    this._initialize(polylines);
  }

  next(): string {
    const polylines = this._polylines;
    const { pageSize, trackedAssets } = this._config;
    const outFeatures: (PointFeature | PolygonFeature)[] = [];
    const start = this._nextPage() * pageSize;
    const end = Math.min(start + pageSize, trackedAssets);
    
    if (start === 0) {
      this._updatePositions(polylines);
    }
    
    for (let i = start; i < end; i++) {
      const feature = this._lastObservations[i];

      if (this._config.extrudePolygons) {
        outFeatures.push(this._extrudePolygon(feature));  
      } else {
        outFeatures.push(feature);  
      }
    }

    return JSON.stringify({
      type: "featureResult",
      features: outFeatures
    });
  }

  private _initialize(polylines: FeatureSet<Polyline>): void {
    const vertexPositions = this._vertexPositions;
    const vertexSum = this._sumPolylineVertices(polylines);
    const vertsPerAsset = vertexSum / this._config.trackedAssets;

    let vertexPos = 0;

    for (let featureIndex = 0; featureIndex < polylines.features.length; featureIndex++) {
      const feature = polylines.features[featureIndex];
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
      const paths = polylines.features[featureIndex].geometry.paths;
      const vertex = paths[pathIndex][vertIndex];
      const vertexNext = paths[pathIndex][vertIndex + 1];
      const x0 = vertex[0];
      const y0 = vertex[1];
      const x1 = vertexNext[0];
      const y1 = vertexNext[1];
      const x = x0 + (x1 - x0) * dist;
      const y = y0 + (y1 - y0) * dist;
      
      this._lastObservations.push({
        attributes: {
          OBJECTID: this._createId(),
          TRACKID: i / 4,
        },
        geometry: { x, y }
      })
    }
  }

  private _sumPolylineVertices(polylines: FeatureSet<Polyline>): number {
    let sum = 0;
    
    for (const feature of polylines.features) {
      const paths = feature.geometry.paths;

      for (const path of paths) {
        sum += path.length;
      }
    }

    return sum;
  }

  private _updatePositions(polylines: FeatureSet<Polyline>): void {
    const vertexPositions = this._vertexPositions;    
    for (let i = 0; i < vertexPositions.length; i += 4) {
      const featureIndex = vertexPositions[i]
      const pathIndex = vertexPositions[i + 1]

      let vertIndex = vertexPositions[i + 2]

      const dist = vertexPositions[i + 3]
      const paths = polylines.features[featureIndex].geometry.paths;

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
      
      const geometry = this._lastObservations[index].geometry;
      const attributes = this._lastObservations[index].attributes;

      attributes.OBJECTID = this._createId(); // New observation needs new oid
      
      geometry.x = x;
      geometry.y = y;

      let nextDist = dist + this._config.distStep;
      
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

  private _nextPage (): number {
    this._page++;
    
    const maxPage = Math.ceil(this._config.trackedAssets / this._config.pageSize);

    if (this._page >= maxPage) {
      this._page = 0;
    }

    return this._page;
  }


  private _extrudePolygon(feature: PointFeature): PolygonFeature {
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

  private _createId(): number {
    const id = this._idCounter;
    
    this._idCounter = ((this._idCounter + 1) % 0xfffffffe); // force nonzero u32
    return id;
  }
}


