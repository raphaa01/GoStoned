#include "../../native/gostone-katago/ios/Core/GoStoneKataGoCore.cpp"
#include <cassert>
#include <sstream>

int main() {
  std::vector<std::string> received;
  OutputBuffer buffer([](const char* line, void* context) {
    static_cast<std::vector<std::string>*>(context)->emplace_back(line);
  }, &received);
  std::ostream output(&buffer);
  output << "{\"turnNumber\":" << std::flush;
  assert(received.empty()); // A tied cin/cerr flush must not emit partial JSON.
  output << "0}\n";
  assert(received.size() == 1 && received[0] == "{\"turnNumber\":0}");
  std::thread flushing([&] {
    for (int i = 0; i < 10000; ++i) buffer.pubsync();
  });
  for (int i = 1; i <= 10000; ++i) {
    const auto line = "{\"turnNumber\":" + std::to_string(i) + "}\n";
    buffer.sputn(line.data(), line.size());
  }
  flushing.join();
  assert(received.size() == 10001);
  for (int i = 0; i <= 10000; ++i)
    assert(received[i] == "{\"turnNumber\":" + std::to_string(i) + "}");
  InputBuffer input;
  std::istream reader(&input);
  input.send("first");
  input.send("second");
  input.close();
  std::string line;
  assert(std::getline(reader, line) && line == "first");
  assert(std::getline(reader, line) && line == "second");
  assert(!std::getline(reader, line));
  return 0;
}
