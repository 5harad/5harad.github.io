---
---
!function(global) {
// function for parsing dates
var parseDate = d3.time.format("%Y-%m-%d").parse;

function loadCsv(path) {
    return new Promise((resolve, reject) => {
        d3.csv(path, (error, data) => {
            if (error) {
                return reject(error);
            }
            resolve(data);
        });
    });
}


let trendData = null;
function formatTrendData(data) {
// load trend line data
  trendData = d3.nest()
    .key(function(d) { return d.state; })
    .key(function(d) { return d.driver_race; })
    .key(function(d) { return d.pre_legalization; })
    .map(data, d3.map);
}

// load rate date
const searchData = [];
function formatSearchData(data) {
  data.forEach( function(d) {
      searchData.push( {
        "state": d.state,
        "driver_race": d.driver_race,
        "quarter": parseDate(d.quarter),
        // convert to boolean
        "pre_legalization": d.pre_legalization == "TRUE",
        // convert rate to per 100 stops
        "search_rate": +d.search_rate * 100
      });
    });
  drawAllSearchCharts();
}

let loadPromise = null;
function loadData() {
    if (!loadPromise) {
        loadPromise = Promise.all([
            loadCsv("/assets/marijuana_trendlines.csv"),
            loadCsv("../assets/marijuana_search_rates.csv"),
        ]);
    }
    return loadPromise;
}

function getSearchStateData(state) {
  return searchData.filter( function(d) {
    if (d.state == state) { return d };
  });
};

function getSearchLineData(state, race, prelegal) {
  return getSearchStateData(state).filter( function(d) {
    if (
      d.driver_race == race && d.pre_legalization == prelegal
      ) { return d };
  });
};

function drawAllSearchCharts() {
  // get a list of states
  const states = [];
  searchData.forEach( function(d) {
    if ($.inArray( d.state, states ) == -1 ) { states.push(d.state) };
  });

  for (let i in states) {
    drawStateSearchChart(states[i]);
  };
};

function drawStateSearchChart(state) {
  var div_id = "#" + state + "_search_chart"

  // set the height div containing chart to be equal to its width
  $(div_id).height($(div_id).width())
  
  var margin = {top: 20, right: 20, bottom: 50, left: 30},
      width = $(div_id).width() - margin.left - margin.right,
      height = $(div_id).height() - margin.top - margin.bottom;

  var x = d3.time.scale()
      .rangeRound([0, width]);

  var y = d3.scale.linear()
      .range([height, 0]);

  var xAxis = d3.svg.axis()
      .scale(x)
      .orient("bottom")
      .ticks(d3.time.year, 1);

  if (state != 'CO' && state != 'WA') {
      xAxis.tickValues([
        parseDate("2011-1-1"),
        parseDate("2013-1-1"), 
        parseDate("2016-1-1")
      ])
    };

  var yAxis = d3.svg.axis()
      .scale(y)
      .orient("left")
      .innerTickSize(-width)
      .outerTickSize(0)
      .tickPadding(10)
      .ticks(6);

  var svg = d3.select(div_id).append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  x.domain(d3.extent(getSearchStateData(state), function(d) { return d.quarter } )).nice();
  y.domain(d3.extent(getSearchStateData(state), function(d) { return d.search_rate } )).nice();

  svg.append("g")
      .attr("class", "x axis")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis)

  svg.append("g")
      .attr("class", "y axis")
      .call(yAxis)
    // .append("text")
    //   .attr("class", "label")
    //   .attr("transform", "rotate(-90)")
    //   .attr("y", -40)
    //   .attr("dy", ".71em")
    //   .style("text-anchor", "end")
    //   .text("Searches per 100 stops");

  // add line marking legalization point
  svg.append("line")
      .attr("x1", x(parseDate("2012-12-31")))
      .attr("y1", y.range()[0])
      .attr("x2", x(parseDate("2012-12-31")))
      .attr("y2", y.range()[1])
      .attr("class", "guide-line")

  var line = d3.svg.line()
    .x(function(d) { return x(d.quarter); })
    .y(function(d) { return y(d.search_rate); });

  svg.append("path")
    .datum(getSearchLineData(state, "white", true))
    .attr("class", "chart-line white")
    .attr("d", line);

  svg.append("path")
    .datum(getSearchLineData(state, "white", false))
    .attr("class", "chart-line white")
    .attr("d", line);

  svg.append("path")
    .datum(getSearchLineData(state, "black", true))
    .attr("class", "chart-line black")
    .attr("d", line);

  svg.append("path")
    .datum(getSearchLineData(state, "black", false))
    .attr("class", "chart-line black")
    .attr("d", line);

  svg.append("path")
    .datum(getSearchLineData(state, "hispanic", true))
    .attr("class", "chart-line hispanic")
    .attr("d", line);

  svg.append("path")
    .datum(getSearchLineData(state, "hispanic", false))
    .attr("class", "chart-line hispanic")
    .attr("d", line);

  // add trendlines
  const state_obj = trendData.get(state)
  state_obj.forEach( function(race) {
    const race_obj = state_obj.get(race)
    race_obj.forEach( function(prelegal) {
      const lineData = race_obj.get(prelegal)[0]
      svg.append("line")
        .attr("x1", x(parseDate(lineData.date_start)))
        .attr("y1", y(+lineData.search_rate_start *100))
        .attr("x2", x(parseDate(lineData.date_end)))
        .attr("y2", y(+lineData.search_rate_end * 100))
        .attr('class', 'trend-line ' + race)
    })
  });
};


d3.selectAll('.line-chart-btns').selectAll('button')
  .on("click", function(d) {
    // only do anything if the clicked button isn't already active
    if ( d3.select(this).classed('inactive')) {
      // switch the other buttons to inactive
      d3.select(this.parentNode)
        .selectAll(".race-btn")
        .classed("inactive", true);
      // make all buttons inactive
      d3.select(this.parentNode).selectAll('button')
        .classed("active", false)
        .classed("inactive", true);
      // switch this button to active
      d3.select(this)
        .classed("inactive", false)
        .classed("active", true);

      // figure out which div to look in 
      const parentDivId = d3.select(this.parentNode).attr('id').replace('_race_btns', '')
      const chartLines = d3.select('#'+parentDivId).selectAll('svg').selectAll('.chart-line')
      const trendLines = d3.select('#'+parentDivId).selectAll('svg').selectAll('.trend-line')
      const race = d3.select(this).text().toLowerCase();

      if ( race == 'all' ) {
        // show all chart and trend lines
        chartLines.attr('opacity', '1')
        trendLines.attr('opacity', '1')
      } else {
        // first, hide all chart and trend lines
        chartLines.attr('opacity', '0')
        trendLines.attr('opacity', '0')
        // show ones with selected race
        chartLines.filter('.'+race).attr('opacity', '1')
        trendLines.filter('.'+race).attr('opacity', '1')
      }
    }
  });


// Load data and render
loadData().then(([trend, search]) => {
    formatTrendData(trend);
    formatSearchData(search);
});

}(window);
