## A perf metrics collection and visualization tool

This is a metrics collection and visualization tool for the rest of this project.
Uses [InfluxDB](https://www.influxdata.com/) for collecting time series data. Uses [Grafana](https://grafana.com/) for visualization.
These tools (Grafana in particular) are not designed for the time resolution (1-10ms) and display latency (<1s) that we're pushing them to.
However it works reasonably well so far and provides a lot of features around storage / querying / visualization out of the box.

### Set up
Run the follwing in this directory to bring it online (requires [Docker](https://www.docker.com/get-started)).
```
docker-compose up -d
```
Now open the Grafana page at <http://127.0.0.1:3000>, the default username:password is admin:admin.

### Working with dashboards
Dashboards can be source-controlled under [grafana-provisioning/dashboards](grafana-provisioning/dashboards). See [Grafana's provisioning docs](https://grafana.com/docs/administration/provisioning/) for details.

#### Editing provisioned dashboards
Provisioned dashboards can be edited in the Grafana UI but you can not save them directly.
Grafana will prompt you to export the JSON which you can use to replace the existing JSON in [grafana-provisioning/dashboards](grafana-provisioning/dashboards).

#### Creating a new dashboard
New dashboards can be created in the Grafana UI but will not be automatically source-controlled.
When you want to store the dashboard in [grafana-provisioning/dashboards](grafana-provisioning/dashboards), use [dashboard export](https://grafana.com/docs/reference/export_import/) to get the json.

### Development Notes
`influxdb.conf` generated using `docker run --rm influxdb:1.7.7 influxd config > influxdb.conf`
