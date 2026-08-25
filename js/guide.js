/* Swagger Dark UI — in-app user guide.
   A modal reference manual, opened from the "?" header button or F1.
   Two-pane layout: section navigation on the left (scroll-spied), the
   guide content on the right. Content is static English HTML below. */
(function () {
  'use strict';

  var kbd = function (keys) {
    return keys.split(' ').map(function (k) { return '<kbd>' + k + '</kbd>'; }).join(' + ');
  };

  var SECTIONS = [
    { id: 'overview', title: 'Overview', html:
      '<p>Swagger Dark UI is a self-contained workbench for OpenAPI documents: a dark-themed ' +
      'Swagger UI preview paired with a YAML editor that validates, autocompletes, searches, ' +
      'imports, exports and mocks — entirely in your browser. Nothing you type ever leaves the page: ' +
      'documents are stored in your browser’s local storage, and the built-in mock server answers ' +
      '“Try it out” requests locally.</p>' +
      '<p>Three ready modes are available from the <em>Spec</em> selector in the header: the bundled ' +
      '<em>Demo API</em> (a full OpenAPI 3.1 feature tour), the live <em>Swagger Petstore</em>, and ' +
      '<em>My API</em> — the editor where you write or import your own documents. ' +
      'Supported input versions: Swagger 2.0 (with one-click conversion), OpenAPI 3.0, 3.1 and 3.2.</p>'
    },
    { id: 'layout', title: 'Workspace and layout', html:
      '<p>In editor mode the window splits into the code pane and the live preview. The ' +
      '<em>Editor / Split / Preview</em> switch in the header selects the layout; the divider between ' +
      'the panes can be dragged to resize them, and a double-click on the divider restores the default. ' +
      'Both the split position and the issues-panel height persist across sessions.</p>' +
      '<table><thead><tr><th>Control</th><th>Purpose</th></tr></thead><tbody>' +
      '<tr><td>Theme toggle</td><td>Dark or light theme; four accent palettes (Default, Nord, Dracula, Catppuccin) via the palette selector.</td></tr>' +
      '<tr><td>Full screen</td><td>Expands the app to the whole display.</td></tr>' +
      '<tr><td>Edit a copy</td><td>On the Demo or Petstore views, creates an editable copy of the current spec in the editor.</td></tr>' +
      '</tbody></table>'
    },
    { id: 'documents', title: 'Managing documents', html:
      '<p>The editor keeps any number of named documents in local storage. The document selector in the ' +
      'toolbar switches between them; <em>New</em> starts one from the template, <em>Rename</em> and ' +
      '<em>Delete</em> manage the current one (Delete asks for a second click to confirm). Every ' +
      'keystroke is saved automatically.</p>' +
      '<p>Ways to bring a document in and out:</p>' +
      '<table><thead><tr><th>Action</th><th>Behavior</th></tr></thead><tbody>' +
      '<tr><td>Open file</td><td>Loads a local YAML or JSON file. Postman collections are detected and converted automatically.</td></tr>' +
      '<tr><td>Load URL</td><td>Fetches a spec over HTTP(S). The remote server must allow cross-origin requests.</td></tr>' +
      '<tr><td>Download</td><td>Saves the current document as <code>openapi.yaml</code> (' + kbd('Ctrl/Cmd S') + ').</td></tr>' +
      '<tr><td>Share</td><td>Packs the document into a compressed link — no server involved; anyone opening the link gets a copy.</td></tr>' +
      '<tr><td>To JSON / To YAML</td><td>Converts the document between the two formats in place.</td></tr>' +
      '</tbody></table>'
    },
    { id: 'insert', title: 'Insert menu', html:
      '<p>The <em>+ Insert</em> menu writes correct OpenAPI structure so you do not have to remember it. ' +
      'Insertions are indentation-aware and land in the right section, which is created when missing; ' +
      'generated names never collide with existing ones, and the placeholder name arrives pre-selected ' +
      'so typing renames it immediately.</p>' +
      '<table><thead><tr><th>Item</th><th>Inserts</th></tr></thead><tbody>' +
      '<tr><td>CRUD resource</td><td>A complete list/create/get/update/delete pair of paths with a shared schema and <code>$ref</code>s.</td></tr>' +
      '<tr><td>New endpoint</td><td>A path with one operation (GET, POST, PUT, PATCH or DELETE) and a response skeleton.</td></tr>' +
      '<tr><td>Operation on this path</td><td>Adds a method to the path the cursor is inside.</td></tr>' +
      '<tr><td>Parameter / Request body / Response</td><td>Added to the operation under the cursor; duplicates are refused with a message.</td></tr>' +
      '<tr><td>Schema / Security scheme</td><td>Appended under <code>components</code>; four scheme presets (API key, Bearer, Basic, OAuth2).</td></tr>' +
      '<tr><td>Example from schema</td><td>Generates an <code>example:</code> block derived from the schema under the cursor, resolving <code>$ref</code>s.</td></tr>' +
      '</tbody></table>'
    },
    { id: 'autocomplete', title: 'Autocomplete', html:
      '<p>Completions appear as you type, or on demand with ' + kbd('Ctrl Space') + '. Suggestions are ' +
      'contextual: operation keys inside a method block, parameter keys inside a <code>- name:</code> ' +
      'item, JSON Schema keywords inside schemas, media types under <code>content:</code>, quoted ' +
      'status codes under <code>responses:</code>.</p>' +
      '<p>Value positions complete too: <code>in:</code>, <code>type:</code>, <code>format:</code> and ' +
      '<code>style:</code> offer their legal values, <code>$ref:</code> lists every component defined in ' +
      'the document, and security requirements offer your declared scheme names.</p>'
    },
    { id: 'rules', title: 'Field rules', html:
      '<p>Place the cursor on a schema property, a component schema or a parameter and a small ' +
      '<em>+ rule</em> control appears at the end of the line. It lists the validation keywords that fit ' +
      'the declared type — <code>minLength</code>, <code>maxLength</code>, <code>pattern</code> and ' +
      '<code>format</code> for strings, <code>minimum</code>/<code>maximum</code> for numbers, ' +
      '<code>minItems</code>/<code>uniqueItems</code> for arrays, plus <code>enum</code>, ' +
      '<code>default</code>, <code>example</code> and <code>description</code> for any type.</p>' +
      '<p><code>required</code> is handled semantically: for a property it is added to the parent ' +
      'schema’s <code>required</code> list (created on demand); for a parameter it sets ' +
      '<code>required: true</code>. Keywords already present are filtered out of the menu.</p>'
    },
    { id: 'validation', title: 'Validation and quick fixes', html:
      '<p>The document is linted continuously against the OpenAPI object tables for its declared version. ' +
      'Findings appear in the panel between the code and the status bar; clicking one jumps to its line, ' +
      'which is also tinted in the editor. Errors are structural or semantic violations; warnings flag ' +
      'legal-but-problematic constructs. The preview keeps rendering regardless — validation informs, ' +
      'it never blocks.</p>' +
      '<p>Most findings carry a one-click <em>Fix</em>: quoting an unquoted version number, creating a ' +
      'missing security scheme, adding a missing <code>description</code> or <code>responses</code> ' +
      'block, removing a misplaced property, switching the document to the OpenAPI version a keyword ' +
      'requires, and more.</p>' +
      '<p>Messages are version-aware across Swagger 2.0 and OpenAPI 3.0–3.2: a 2.0 keyword in a 3.x ' +
      'document names its modern replacement, a 3.1-only feature in a 3.0 document offers a version ' +
      'bump, and constructs the specification ignores (such as a header parameter named ' +
      '<code>Authorization</code>) are explained.</p>' +
      '<p>Warnings can be dismissed individually with their close control; dismissals are remembered per ' +
      'document and the status bar keeps an honest count (for example “Valid — rendering live ' +
      '(2 hidden)”). A footer row restores all hidden warnings at once. Errors cannot be dismissed. ' +
      'The panel’s height is adjustable by dragging its top edge.</p>'
    },
    { id: 'search', title: 'Search', html:
      '<p><strong>In the code.</strong> ' + kbd('Ctrl/Cmd F') + ' — or the magnifier button in the ' +
      'toolbar — opens the find bar. Matches highlight live with a position counter; ' + kbd('Enter') +
      ' and ' + kbd('Shift Enter') + ' cycle forward and back, ' + kbd('Esc') + ' closes. A selection ' +
      'made before opening becomes the initial query.</p>' +
      '<p><strong>In the preview.</strong> The search field above the operations searches the parsed ' +
      'document, not just what is visible: paths, methods, summaries, descriptions, tags, operation ' +
      'ids, parameter names, media types, status codes, security scheme names, and schema property ' +
      'names and enum values with <code>$ref</code>s resolved. Multiple words must all match. ' +
      'Tag sections whose operations are all filtered out disappear; a counter reports the visible ' +
      'share, and ' + kbd('Esc') + ' clears the query.</p>' +
      '<p><strong>Preview to source.</strong> In editor mode, clicking an operation header or a schema ' +
      'name in the preview scrolls the editor to the corresponding lines.</p>'
    },
    { id: 'mock', title: 'Try it out and the mock server', html:
      '<p>Every operation’s <em>Try it out</em> works immediately: the default server entry is an ' +
      'in-browser mock, so requests are answered locally from your schemas and examples and never leave ' +
      'the page. The mock is stateful — <code>POST</code> creates records held in memory, <code>GET</code> ' +
      'lists or returns them, <code>PUT</code>/<code>PATCH</code> update, <code>DELETE</code> removes. ' +
      'Endpoints without stored data respond with examples derived from their schemas.</p>' +
      '<table><thead><tr><th>Request header</th><th>Effect</th></tr></thead><tbody>' +
      '<tr><td><code>X-Mock-Status</code></td><td>Forces a specific documented status code in the response.</td></tr>' +
      '<tr><td><code>X-Mock-Delay</code></td><td>Delays the response by the given number of milliseconds.</td></tr>' +
      '</tbody></table>' +
      '<p>Your own servers stay selectable in the Servers dropdown, including a free-text entry for any ' +
      'base URL such as <code>http://localhost:3000</code>. Real servers must allow cross-origin ' +
      'requests from the page.</p>'
    },
    { id: 'import', title: 'Importing', html:
      '<p><strong>Postman collections</strong> (v2 / v2.1 exports) are converted to OpenAPI 3.0.3 ' +
      'automatically when pasted, opened as a file or fetched from a URL. The conversion covers: ' +
      'folders as tags, the collection base URL as a server, all authentication types (API key, Bearer, ' +
      'Basic, OAuth2 with the matching flow — a raw <code>Authorization</code> header also becomes a ' +
      'bearer scheme), path and query variables, JSON, form-urlencoded, multipart, GraphQL and XML ' +
      'bodies, and every saved response: one per status code becomes its example, several variants of ' +
      'the same code become named examples shown as a dropdown, and meaningful response headers are ' +
      'documented while transport noise is dropped. Conversion is lossy in the Postman direction ' +
      '(scripts and tests are not representable), so imports are saved as a new document.</p>' +
      '<p><strong>Swagger 2.0</strong> documents are recognized and render as-is; a banner under the ' +
      'editor offers a one-click conversion to OpenAPI 3.0 — servers from <code>host</code>/' +
      '<code>basePath</code>, body and form parameters to <code>requestBody</code>, ' +
      '<code>definitions</code> to <code>components</code>, references rewritten.</p>'
    },
    { id: 'history', title: 'Version history', html:
      '<p>The <em>History</em> control keeps compressed snapshots of each document: one is recorded ' +
      'automatically after meaningful changes (rate-limited), and <em>Snapshot now</em> stores one on ' +
      'demand. Up to twenty snapshots are kept per document in local storage.</p>' +
      '<p>Each entry offers <em>Restore</em> — the current state is snapshotted first, so restoring is ' +
      'itself reversible — and <em>Diff</em>, a color-coded line comparison against the current text.</p>'
    },
    { id: 'export', title: 'Exporting', html:
      '<table><thead><tr><th>Format</th><th>Notes</th></tr></thead><tbody>' +
      '<tr><td>YAML file</td><td><em>Download</em> (or ' + kbd('Ctrl/Cmd S') + ') saves the raw document.</td></tr>' +
      '<tr><td>Postman Collection v2.1</td><td>Folders per tag, URL variables for path parameters, example values and bodies derived from schemas, authentication mapped from the security schemes.</td></tr>' +
      '<tr><td>Standalone HTML</td><td>A single self-contained file with Swagger UI embedded — opens from disk with no network access; suitable for e-mailing or archiving documentation.</td></tr>' +
      '</tbody></table>'
    },
    { id: 'shortcuts', title: 'Keyboard shortcuts', html:
      '<table><thead><tr><th>Shortcut</th><th>Action</th></tr></thead><tbody>' +
      '<tr><td>' + kbd('Ctrl/Cmd S') + '</td><td>Download the current document</td></tr>' +
      '<tr><td>' + kbd('Ctrl/Cmd Enter') + '</td><td>Render immediately (skip the debounce)</td></tr>' +
      '<tr><td>' + kbd('Ctrl/Cmd F') + '</td><td>Find in code</td></tr>' +
      '<tr><td>' + kbd('Ctrl Space') + '</td><td>Autocomplete</td></tr>' +
      '<tr><td>' + kbd('Ctrl/Cmd Z') + ' / ' + kbd('Ctrl/Cmd Shift Z') + '</td><td>Undo / redo</td></tr>' +
      '<tr><td>' + kbd('Enter') + ' / ' + kbd('Shift Enter') + '</td><td>Next / previous match in the find bar</td></tr>' +
      '<tr><td>' + kbd('Esc') + '</td><td>Close the find bar, clear the operation search, dismiss menus, close this guide</td></tr>' +
      '<tr><td>' + kbd('F1') + '</td><td>Open this guide</td></tr>' +
      '</tbody></table>'
    },
    { id: 'selfhost', title: 'Running it yourself', html:
      '<p>The site is fully static and self-contained — all third-party assets are vendored, so it works ' +
      'offline and in air-gapped networks. Any static file server can host it:</p>' +
      '<pre>python3 -m http.server 8000\n# or, with Docker:\ndocker compose up   # http://localhost:8080</pre>' +
      '<p>The site is also an installable application: browsers that support progressive web apps ' +
      'offer an install control in the address bar (or “Add to Home Screen” on mobile). The installed ' +
      'app opens in its own window and keeps working without a network connection — a service worker ' +
      'caches the entire application on first visit and refreshes it in the background on later ' +
      'loads.</p>' +
      '<p>Documents, snapshots, dismissed warnings and layout preferences live in the browser’s ' +
      'local storage of whoever is using the page; the server stores nothing.</p>'
    },
    { id: 'license', title: 'License', html:
      '<p>The project is available under the Elastic License 2.0. In short: free to use, copy, modify ' +
      'and embed — commercially included — but it may not be offered to third parties as a hosted or ' +
      'managed service, license notices must stay intact, and license-key functionality may not be ' +
      'circumvented. Vendored third-party assets keep their own licenses. See the LICENSE file in the ' +
      'repository for the full text.</p>'
    }
  ];

  var overlay = null;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'sdui-modal-overlay';
    overlay.id = 'guide-overlay';

    var nav = SECTIONS.map(function (s) {
      return '<a href="#guide-' + s.id + '" data-target="guide-' + s.id + '">' + s.title + '</a>';
    }).join('');
    var body = SECTIONS.map(function (s, i) {
      return '<section class="g-section" id="guide-' + s.id + '">' +
        '<h2><span class="g-num">' + String(i + 1).padStart(2, '0') + '</span>' + s.title + '</h2>' +
        s.html + '</section>';
    }).join('');

    overlay.innerHTML =
      '<div class="sdui-modal sdui-guide" role="dialog" aria-modal="true" aria-label="User guide">' +
      '  <div class="sdui-modal-head">' +
      '    <div class="g-title">User Guide<span class="g-subtitle">Swagger Dark UI reference</span></div>' +
      '    <button id="guide-close" class="sdui-tool-btn" type="button" title="Close (Esc)">Close</button>' +
      '  </div>' +
      '  <div class="g-body">' +
      '    <nav class="g-nav" aria-label="Guide sections">' + nav + '</nav>' +
      '    <div class="g-content">' + body + '</div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);

    var content = overlay.querySelector('.g-content');
    var links = overlay.querySelectorAll('.g-nav a');

    overlay.querySelector('#guide-close').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    function setActive(index) {
      for (var j = 0; j < links.length; j++) {
        links[j].classList.toggle('active', j === index);
      }
    }

    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (e) {
        e.preventDefault();
        var target = overlay.querySelector('#' + this.getAttribute('data-target'));
        if (!target) return;
        // Highlight immediately — the spy confirms once the scroll settles.
        var self = this;
        for (var k = 0; k < links.length; k++) {
          if (links[k] === self) setActive(k);
        }
        content.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
      });
    }

    // Scroll-spy: highlight the section currently at the top of the viewport;
    // at the very bottom the last section wins regardless of its height.
    function spy() {
      var sections = content.querySelectorAll('.g-section');
      var active = 0;
      if (content.scrollTop + content.clientHeight >= content.scrollHeight - 2) {
        active = sections.length - 1;
      } else {
        var top = content.scrollTop + 40;
        for (var i = 0; i < sections.length; i++) {
          if (sections[i].offsetTop <= top) active = i;
        }
      }
      setActive(active);
    }
    content.addEventListener('scroll', spy);
    spy();
  }

  function open() {
    if (!overlay) build();
    overlay.hidden = false;
    overlay.querySelector('.g-content').focus();
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function init() {
    var btn = document.getElementById('guide-open');
    if (btn) btn.addEventListener('click', open);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'F1') {
        e.preventDefault();
        open();
      } else if (e.key === 'Escape' && overlay && !overlay.hidden) {
        close();
      }
    });
  }

  window.SduiGuide = { init: init, open: open, close: close };
})();
