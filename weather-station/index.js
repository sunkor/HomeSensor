const Influx = require("influx");
const AsyncPolling = require("async-polling");
const fetch = require("node-fetch");
var d2d = require("degrees-to-direction");

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const zipCode = process.env.WEATHER_API_QUERY_POSTCODE;
const countryCode = process.env.WEATHER_API_QUERY_COUNTRY_CODE;
const units = "metric";
const appid = process.env.WEATHER_API_KEY;
const apiEndpoint = process.env.WEATHER_API_ENDPOINT;
const url = `${apiEndpoint}?zip=${zipCode},${countryCode}&units=${units}&appid=${appid}`;

if (process.env.NODE_ENV !== "production") {
  console.log({
    apiEndpoint: apiEndpoint,
    apiKey: appid,
    postCode: zipCode,
    countryCode: countryCode,
    invokeUrl: url
  });
}

const influx = new Influx.InfluxDB({
  host: "influxdb",
  database: "home_sensors_db",
  schema: [
    {
      measurement: "temperature_data_in_celcius",
      fields: {
        temperature: Influx.FieldType.FLOAT
      },
      tags: ["location"]
    },
    {
      measurement: "humidity_data",
      fields: {
        humidity: Influx.FieldType.FLOAT
      },
      tags: ["location"]
    },
    {
      measurement: "daily_read",
      fields: {
        wind_speed: Influx.FieldType.FLOAT,
        wind_direction: Influx.FieldType.FLOAT,
        sunrise: Influx.FieldType.INTEGER,
        sunset: Influx.FieldType.INTEGER,
        weather_main: Influx.FieldType.STRING,
        weather_description: Influx.FieldType.STRING
      },
      tags: ["location"]
    }
  ]
});

var polling = AsyncPolling(function(end) {
  console.log("fetching.." + url);
  fetch(url)
    .then(response => response.json())
    .then(json => end(null, json))
    .catch(message => {
      end(message, "error occured");
    });
}, 5000);

polling.on("error", function(error) {
  console.log(error);
});
polling.on("result", function(json) {
  if (json.cod === 200) {
    var timestamp = json.dt;
    var utcDate = new Date(timestamp * 1000);
    var localDate = new Date(utcDate);

    console.log(`Utc - ${utcDate}`);
    console.log(`Local time - ${localDate}`);

    var summary_data = {
      name: json.name,
      currentTemp: json.main.temp,
      feels_like: json.main.feels_like,
      temp_min: json.main.temp_min,
      temp_max: json.main.temp_max,
      humidity: json.main.humidity,
      wind_speed: json.wind.speed,
      wind_direction: json.wind.deg,
      sunrise: json.sys.sunrise,
      sunset: json.sys.sunset,
      weather_main: json.weather[0].main,
      weather_description: json.weather[0].description
    };

    var summary_data_for_logs = {
      ...summary_data,
      wind_direction_friendly: d2d(summary_data.wind_direction)
    };

    console.log(summary_data_for_logs);

    influx
      .writePoints([
        {
          measurement: "temperature_data_in_celcius",
          fields: {
            temperature: summary_data.currentTemp
          },
          tags: { location: summary_data.name }
        },
        {
          measurement: "temperature_data_in_celcius",
          fields: {
            temperature: summary_data.feels_like
          },
          tags: { location: `${summary_data.name}_feels_like` }
        },
        {
          measurement: "humidity_data",
          fields: {
            humidity: summary_data.humidity
          },
          tags: { location: summary_data.name }
        },
        {
          measurement: "daily_read",
          fields: {
            wind_speed: summary_data.wind_speed,
            wind_direction: summary_data.wind_direction,
            sunrise: summary_data.sunrise,
            sunset: summary_data.sunset,
            weather_main: summary_data.weather_main,
            weather_description: summary_data.weather_description
          },
          tags: { location: summary_data.name }
        }
      ])
      .then(() => {
        console.log(summary_data_for_logs);
      });
  } else {
    console.log("did not fetch data");
  }
});

setTimeout(function() {
  influx
    .getDatabaseNames()
    .then(names => {
      if (!names.includes("home_sensors_db")) {
        return influx.createDatabase("home_sensors_db");
      }
    })
    .then(() => {
      console.log("influxdb ready. Begin polling...");
      polling.run(); // Let's start polling.
    })
    .catch(error => console.log({ error }));
}, 10000);
