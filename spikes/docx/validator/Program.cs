// Validates .docx files with the Open XML SDK's validator (what Word's own SDK checks), for Microsoft 365.
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

var failed = 0;
foreach (var path in args)
{
    using var doc = WordprocessingDocument.Open(path, false);
    var errors = new OpenXmlValidator(FileFormatVersions.Microsoft365).Validate(doc).ToList();
    Console.WriteLine($"{Path.GetFileName(path)}: {errors.Count} error(s)");
    foreach (var e in errors.Take(10))
        Console.WriteLine($"  {e.ErrorType} {e.Part?.Uri} {e.Path?.XPath}: {e.Description}");
    if (errors.Count > 0) failed++;
}
return failed == 0 ? 0 : 1;
