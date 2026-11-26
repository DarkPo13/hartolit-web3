// CloudFront Function (runtime 2.0) on every request bound for a Lambda origin.
// It must stay under CloudFront's 10 KB limit.
var crypto = require("crypto");

// Written only by CloudFront or the Lambda@Edge signer. A viewer's value could break the
// origin signature and leave a cached error for other visitors.
var SIGNATURE_HEADERS = ["x-amz-content-sha256", "x-amz-date", "x-amz-security-token"];
// OpenNext turns these into location headers. The app does not use them, and a viewer must
// not be able to choose them.
var LOCATION_HEADERS = ["x-open-next-city", "x-open-next-country", "x-open-next-region", "x-open-next-latitude", "x-open-next-longitude"];
var CACHE_KEY_HEADERS = ["rsc", "next-router-prefetch", "next-router-state-tree", "next-url", "x-prerender-revalidate"];
// CloudFront's origin limit is 10,240 bytes; 512 are kept for what it adds afterwards.
var SAFE_HEADER_BYTES = 9728;

function headerValue(headers, name) {
  var header = headers[name];
  if (!header) return "";
  if (header.multiValue) return header.multiValue.map(function (item) { return item.value; }).join(",");
  return header.value || "";
}

function cacheKey(request) {
  var key = "";
  if (request.uri.startsWith("/_next/image")) {
    key = headerValue(request.headers, "accept");
  } else {
    for (var i = 0; i < CACHE_KEY_HEADERS.length; i++) key += headerValue(request.headers, CACHE_KEY_HEADERS[i]);
  }
  var bypass = request.cookies && request.cookies["__prerender_bypass"];
  if (bypass) key += bypass.value;
  return crypto.createHash("md5").update(key).digest("hex");
}

function headerBytes(request) {
  var size = 0;
  for (var name in request.headers) {
    var header = request.headers[name];
    if (header.multiValue) {
      for (var i = 0; i < header.multiValue.length; i++) size += name.length + header.multiValue[i].value.length + 4;
    } else if (header.value) {
      size += name.length + header.value.length + 4;
    }
  }
  var cookies = [];
  for (var cookieName in request.cookies) {
    var cookie = request.cookies[cookieName];
    if (cookie.multiValue) {
      for (var j = 0; j < cookie.multiValue.length; j++) cookies.push(cookieName + "=" + cookie.multiValue[j].value);
    } else {
      cookies.push(cookieName + "=" + cookie.value);
    }
  }
  if (cookies.length) size += 10 + cookies.join("; ").length;
  return size;
}

function handler(event) {
  var request = event.request;
  var i;

  // The only address the app trusts for sign-in limits (D78). Must equal lib/client-ip.ts.
  event.request.headers["x-hartolit-client-ip"] = { value: event.viewer.ip, multiValue: [{ value: event.viewer.ip }] };

  for (i = 0; i < SIGNATURE_HEADERS.length; i++) delete request.headers[SIGNATURE_HEADERS[i]];
  for (i = 0; i < LOCATION_HEADERS.length; i++) delete request.headers[LOCATION_HEADERS[i]];

  request.headers["x-forwarded-host"] = { value: request.headers.host.value };

  // CloudFront does not allow "/" in a query string key.
  for (var key in request.querystring) {
    if (key.includes("/")) {
      request.querystring[encodeURIComponent(key)] = request.querystring[key];
      delete request.querystring[key];
    }
  }

  request.headers["x-open-next-cache-key"] = { value: cacheKey(request) };

  if (headerBytes(request) > SAFE_HEADER_BYTES) {
    return {
      statusCode: 431,
      statusDescription: "Request Header Fields Too Large",
      headers: {
        "cache-control": { value: "no-store" },
        "content-type": { value: "text/plain; charset=utf-8" },
      },
      body: { encoding: "text", data: "Request headers are too large. Reduce cookie size and try again." },
    };
  }

  return request;
}
