---
---

var misData = [];

var parseDate = d3.time.format("%Y-%m-%d").parse;

d3.csv("../assets/marijuana_misdemeanor_rates.csv", function(error, data) {
  data.forEach( function(d) {
      misData.push( {
        "state": d.state,
        "driver_race": d.driver_race,
        "quarter": parseDate(d.quarter),
        // convert to boolean
        "pre_legalization": d.pre_legalization == "TRUE",
        // convert rate to per 100 stops
        "misdemeanor_rate": +d.misdemeanor_rate * 100
      });
    });
  drawMisdemeanorChart('CO');
  drawMisdemeanorChart('WA');
});

function getStateData(state) {
  return misData.filter( function(d) {
    if (d.state == state) { return d };
  });
};

function getLineData(state, race, prelegal) {
  return getStateData(state).filter( function(d) {
    if (
      d.driver_race == race && d.pre_legalization == prelegal
      ) { return d };
  });
};

function drawMisdemeanorChart(state) {
  var div_id = "#" + state + "_misdemeanor_chart"
  
  var margin = {top: 20, right: 20, bottom: 30, left: 100},
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

  x.domain(d3.extent(getStateData(state), function(d) { return d.quarter } )).nice();
  y.domain(d3.extent(getStateData(state), function(d) { return d.misdemeanor_rate } )).nice();

  svg.append("g")
      .attr("class", "x axis")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis)

  svg.append("g")
      .attr("class", "y axis")
      .call(yAxis)
    .append("text")
      .attr("class", "label")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Misdemeanors per 100 stops");

  // add line marking legalization point
  svg.append("line")
      .attr("x1", x(parseDate("2012-12-31")))
      .attr("y1", y.range()[0])
      .attr("x2", x(parseDate("2012-12-31")))
      .attr("y2", y.range()[1])
      .attr("class", "guide-line")

  var line = d3.svg.line()
    .x(function(d) { return x(d.quarter); })
    .y(function(d) { return y(d.misdemeanor_rate); });

  svg.append("path")
    .datum(getLineData(state, "white", true))
    .attr("class", "line")
    .attr("stroke", "rgb(244, 223, 66)")
    .attr("d", line);

  svg.append("path")
    .datum(getLineData(state, "white", false))
    .attr("class", "line")
    .attr("stroke", "rgb(244, 223, 66)")
    .attr("d", line);

  svg.append("path")
    .datum(getLineData(state, "black", true))
    .attr("class", "line")
    .attr("stroke", "rgb(32, 144, 255)")
    .attr("d", line);

  svg.append("path")
    .datum(getLineData(state, "black", false))
    .attr("class", "line")
    .attr("stroke", "rgb(32, 144, 255)")
    .attr("d", line);

  svg.append("path")
    .datum(getLineData(state, "hispanic", true))
    .attr("class", "line")
    .attr("stroke", "rgb(32, 255, 85)")
    .attr("d", line);

  svg.append("path")
    .datum(getLineData(state, "hispanic", false))
    .attr("class", "line")
    .attr("stroke", "rgb(32, 255, 85)")
    .attr("d", line);

};
