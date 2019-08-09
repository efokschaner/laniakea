import * as Influx from 'influx';

let dbName = 'network_integration_test_db';

let measurementName = 'integration_test_stats';

export interface IntegrationTestMeasurement {
  acksReceived: number,
  messagesSent: number,
  peerName: string
}

let integrationTestStatsSchema =  {
  measurement: measurementName,
  fields: {
    acksReceived: Influx.FieldType.INTEGER,
    messagesSent: Influx.FieldType.INTEGER,
  },
  tags: [
    'peerName',
    'pid',
    'sessionStartTimeISO8601'
  ]
};

export class MetricsCollector {
  private readonly sessionStartTime = new Date();
  private readonly sessionStartTimeISOString = this.sessionStartTime.toISOString();
  private influx: Influx.InfluxDB;
  public constructor() {
    this.influx = new Influx.InfluxDB({
      host: '127.0.0.1',
      database: dbName,
      schema: [
        integrationTestStatsSchema
      ]
    });
  }

  public async collectIntegrationTestMeasurements(measurements: IntegrationTestMeasurement[]) {
    try {
      await this.influx.writeMeasurement(measurementName, measurements.map((m) => {
        return {
          fields: {
            acksReceived: m.acksReceived,
            messagesSent: m.messagesSent
          },
          tags: {
            peerName: m.peerName,
            pid: String(process.pid),
            sessionStartTimeISO8601: this.sessionStartTimeISOString,
          }
        };
      }));
    } catch (error) {
      console.warn('Failed to send metrics: ', error.stack || error);
    }
  }

  public async createDatabaseIfNeeded() {
    let names = await this.influx.getDatabaseNames();
    if (!names.includes(dbName)) {
      await this.influx.createDatabase(dbName);
      await this.influx.createRetentionPolicy('24hour', {
        duration: '24h',
        replication: 1,
        isDefault: true,
        database: dbName
      });
    }
  }
}

export async function createMetricsCollector() {
  let collector = new MetricsCollector();
  await collector.createDatabaseIfNeeded();
  return collector;
}
