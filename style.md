Delaware Document Style Guide
Complete styling reference for professional business documents

Brand Colors
Primary Colors
Primary Red - Main background color and primary branding - RGB: 196, 40, 40 - CMYK: 16, 95, 87, 6 - HEX: #c42828 - Pantone: 1795C - RAL: 3002 - Usage: Main headings (h1), primary branding elements, opportunity cards background

Dot Red - Logo dot and accent elements - RGB: 239, 70, 60 - CMYK: 0, 83, 73, 0 - HEX: #ef463c - Pantone: 7417C - RAL: 3028 - Usage: Header accent lines, border highlights, call-to-action elements

Sub Red 1 - Lighter accent for backgrounds - RGB: 238, 118, 132 - CMYK: 0, 66, 34, 0 - HEX: #ee7684 - Pantone: 177C - RAL: 3017 - Usage: Light background washes, gradient combinations

Sub Red 2 - Darker accent for secondary headings - RGB: 148, 25, 20 - CMYK: 26, 100, 100, 28 - HEX: #941914 - Pantone: 7628C - RAL: 3003 - Usage: Secondary headings (h2), darker red elements

Secondary Colors
Teal - Vibrant accent color - RGB: 114, 196, 191 - CMYK: 57, 0, 30, 0 - HEX: #72c4bf - Pantone: 3245C - RAL: 6027 - Usage: Tertiary headings (h3), teal content boxes, step numbers

Purple - Secondary accent color - RGB: 173, 155, 203 - CMYK: 37, 42, 0, 0 - HEX: #ad9bcb - Pantone: 2645C - RAL: 4005 - Usage: Fourth-level headings (h4), purple content boxes, accent elements

Neutral Colors
Text Gray - Primary text color - RGB: 60, 60, 60 - CMYK: 0, 0, 0, 90 - HEX: #3c3c3c - Pantone: Black - RAL: 9004 - Usage: Body text, primary content

Mid Gray - Secondary text and borders - RGB: 153, 153, 153 - CMYK: 41, 32, 32, 11 - HEX: #999999 - Pantone: 423C - RAL: 7037 - Usage: Secondary text, metadata, borders, page numbers

Light Gray - Backgrounds and subtle elements - RGB: 245, 245, 245 - CMYK: 5, 3, 4, 0 - HEX: #f5f5f5 - Pantone: 427C - RAL: 7035 - Usage: Content box backgrounds, page backgrounds, subtle dividers

Typography Hierarchy
H1 - Main Document Title
font-size: 36px;
font-weight: 800;
color: #c42828;
margin-bottom: 20px;
line-height: 1.2;
H2 - Section Headers
font-size: 28px;
font-weight: 700;
color: #941914;
margin: 40px 0 25px 0;
line-height: 1.3;
border-left: 5px solid #ef463c;
padding-left: 20px;
H3 - Subsection Headers
font-size: 22px;
font-weight: 600;
color: #72c4bf;
margin: 30px 0 15px 0;
H4 - Component Headers
font-size: 18px;
font-weight: 600;
color: #ad9bcb;
margin: 20px 0 10px 0;
Body Text & Lists
font-size: 16px;
line-height: 1.6;
margin-bottom: 15px;
color: #3c3c3c;
Subtitle/Lead Text
font-size: 20px;
color: #72c4bf;
font-weight: 600;
margin-bottom: 30px;
Layout Structure
Page Layout
.document {
    max-width: 210mm; /* A4 width */
    margin: 0 auto;
    background: white;
    box-shadow: 0 0 20px rgba(60,60,60,0.1);
}

.page {
    min-height: 297mm; /* A4 height */
    padding: 40px;
    page-break-after: always;
    position: relative;
}
Header Structure
.header {
    border-bottom: 4px solid #c42828;
    padding-bottom: 20px;
    margin-bottom: 40px;
    position: relative;
}

.header::after {
    content: '';
    position: absolute;
    bottom: -4px;
    right: 0;
    width: 100px;
    height: 4px;
    background: #ef463c;
}
Logo Area
.logo-area {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.logo {
    font-size: 24px;
    font-weight: 800;
    color: #c42828;
}

.logo::after {
    content: '●';
    color: #ef463c;
    margin-left: 5px;
}
Content Components
Content Boxes
Standard Content Box:

.content-box {
    background: #f5f5f5;
    padding: 25px;
    border-radius: 8px;
    border-left: 5px solid #c42828;
    margin: 25px 0;
}
Teal Variant:

.content-box.teal {
    border-left-color: #72c4bf;
    background: rgba(114, 196, 191, 0.1);
}
Purple Variant:

.content-box.purple {
    border-left-color: #ad9bcb;
    background: rgba(173, 155, 203, 0.1);
}
Red Accent Variant:

.content-box.red-accent {
    border-left-color: #ef463c;
    background: rgba(239, 70, 60, 0.1);
}
Grid Layouts
Two Column:

.two-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin: 25px 0;
}
Three Column:

.three-column {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 20px;
    margin: 25px 0;
}
Opportunity Cards
.opportunity-card {
    background: linear-gradient(135deg, #c42828, #941914);
    color: white;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
    margin-bottom: 15px;
}

.opportunity-card h4 {
    color: white;
    margin-bottom: 10px;
    font-size: 16px;
}

.opportunity-card p {
    color: rgba(255,255,255,0.9);
    font-size: 14px;
    margin: 0;
}
AI Emphasis Boxes
.ai-emphasis {
    background: linear-gradient(135deg, #ef463c, #ee7684);
    padding: 25px;
    border-radius: 8px;
    color: white;
    margin: 25px 0;
    text-align: center;
}

.ai-emphasis h3, .ai-emphasis h4 {
    color: white;
}

.ai-emphasis p {
    color: rgba(255,255,255,0.95);
}
Statistics Cards
.stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin: 30px 0;
}

.stat-card {
    background: white;
    border: 2px solid #72c4bf;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
}

.stat-number {
    font-size: 32px;
    font-weight: bold;
    color: #c42828;
    display: block;
    margin-bottom: 5px;
}

.stat-label {
    font-size: 14px;
    color: #3c3c3c;
    margin: 0;
}
Step Indicators
.methodology-steps {
    display: flex;
    justify-content: space-between;
    margin: 30px 0;
    gap: 20px;
}

.step {
    text-align: center;
    flex: 1;
    padding: 20px 10px;
}

.step-number {
    background: #72c4bf;
    color: white;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 15px;
    font-size: 18px;
    font-weight: bold;
}
Competitive Positioning Boxes
.competitor-box {
    background: #f5f5f5;
    padding: 20px;
    border-radius: 8px;
    margin: 15px 0;
    border-left: 5px solid #999999;
}

.competitor-box.tier1 { border-left-color: #941914; }
.competitor-box.tier2 { border-left-color: #72c4bf; }
.competitor-box.tier3 { border-left-color: #ad9bcb; }

.advantage {
    color: #72c4bf;
    font-weight: 600;
}

.weakness {
    color: #ef463c;
    font-weight: 600;
}
Special Elements
Big Numbers/Statistics
.big-number {
    font-size: 48px;
    font-weight: 900;
    color: #c42828;
    text-align: center;
    margin: 20px 0;
}
Highlight Text
.highlight {
    color: #c42828;
    font-weight: 700;
}
Page Numbers
.page-number {
    position: absolute;
    bottom: 20px;
    right: 40px;
    color: #999999;
    font-size: 12px;
}
List Styling
Standard Lists
ul {
    padding-left: 25px;
    margin: 15px 0;
}

li {
    margin-bottom: 10px;
}

li strong {
    color: #c42828;
}
Spacing Guidelines
Margins
Page margins: 40px all sides
Section spacing: 40px between major sections
Component spacing: 25px between components
Element spacing: 15px between related elements
Padding
Content boxes: 25px internal padding
Cards: 20px internal padding
Step indicators: 20px vertical, 10px horizontal
Print & PDF Optimization
Print Styles
@media print {
    body {
        background: white;
    }
    .document {
        box-shadow: none;
    }
    .page {
        page-break-after: always;
    }
    .page:last-child {
        page-break-after: avoid;
    }
}
Font Recommendations
Primary Font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
Fallback: Standard system fonts for maximum compatibility
Usage Instructions for Claude.AI
When creating Delaware business documents, always follow these guidelines:

1. Document Structure
<div class="document">
    <div class="page">
        <div class="header">
            <div class="logo-area">
                <div class="logo">delaware</div>
                <div class="date">[Current Date]</div>
            </div>
        </div>
        <!-- Page content here -->
        <div class="page-number">[Page Number]</div>
    </div>
</div>
2. Color Usage Priority
Primary Red (#c42828): Main headings, branding
Dot Red (#ef463c): Accents, highlights, borders
Teal (#72c4bf): Secondary headings, positive elements
Purple (#ad9bcb): Tertiary elements, variety
Grays: Text and backgrounds as specified
3. Typography Hierarchy Rules
Always use the specified font sizes and weights
Maintain consistent spacing between elements
Use color coding as specified for each heading level
Apply border-left styling to h2 elements
4. Component Selection Guide
Content boxes: Use for grouped information
Opportunity cards: Use for product/service highlights
AI emphasis boxes: Use for key strategic messages
Stats cards: Use for quantitative information
Step indicators: Use for process/methodology explanations
5. Layout Best Practices
Use grid systems for multi-column layouts
Maintain consistent margins and padding
Ensure proper spacing between components
Always include page numbers and headers
6. Quality Checklist
Before finalizing any document, verify: - [ ] All colors match Delaware brand specifications - [ ] Typography hierarchy is correctly applied - [ ] Spacing is consistent throughout - [ ] Headers and logos are properly formatted - [ ] Content boxes use appropriate variants - [ ] Print/PDF optimization is applied - [ ] Page breaks are appropriate for content flow