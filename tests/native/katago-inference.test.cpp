#include "GoStoneKataGoCore.h"
#include "external/nlohmann_json/json.hpp"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

using nlohmann::json;

struct Responses {
  std::mutex mutex;
  std::condition_variable ready;
  std::vector<json> lines;
  bool exited = false;
  std::string error;
};

static void onLine(const char* line, void* context) {
  auto& responses = *static_cast<Responses*>(context);
  auto value = json::parse(line, nullptr, false);
  if (value.is_discarded()) return;
  {
    std::lock_guard<std::mutex> lock(responses.mutex);
    responses.lines.push_back(std::move(value));
  }
  responses.ready.notify_one();
}

static void onExit(int code, const char* error, void* context) {
  auto& responses = *static_cast<Responses*>(context);
  {
    std::lock_guard<std::mutex> lock(responses.mutex);
    responses.exited = true;
    responses.error = error ? error : "exit " + std::to_string(code);
  }
  responses.ready.notify_one();
}

static void checkBoard(const char* model, const char* config, int size) {
  Responses responses;
  std::unique_ptr<GoStoneKataGoEngine, decltype(&gostone_katago_destroy)> engine(
    gostone_katago_start(model, config, size, onLine, onExit, &responses), gostone_katago_destroy);
  if (!engine) throw std::runtime_error("Could not start KataGo");

  auto query = [&](const char* id, const json& turns, bool ownership) {
    json request = {
      {"id", id}, {"rules", "japanese"}, {"komi", 6.5}, {"maxVisits", 4},
      {"boardXSize", size}, {"boardYSize", size}, {"analyzeTurns", turns},
      {"moves", json::array({json::array({"B", "D4"})})}, {"includeOwnership", ownership},
    };
    if (!gostone_katago_send(engine.get(), request.dump().c_str())) {
      throw std::runtime_error("Could not send KataGo query");
    }
    std::unique_lock<std::mutex> lock(responses.mutex);
    if (!responses.ready.wait_for(lock, std::chrono::seconds(35), [&] {
      return responses.exited || responses.lines.size() >= turns.size()
        || (!responses.lines.empty() && responses.lines.front().contains("error"));
    })) throw std::runtime_error("KataGo did not return the requested positions");
    if (responses.exited) throw std::runtime_error(responses.error);
    auto remainingTurns = turns.get<std::vector<int>>();
    for (const auto& line : responses.lines) {
      if (line.contains("error")) throw std::runtime_error(line.dump());
      const int turn = line.at("turnNumber");
      auto remaining = std::find(remainingTurns.begin(), remainingTurns.end(), turn);
      if (line.at("id") != id || remaining == remainingTurns.end()
        || line.at("rootInfo").at("currentPlayer") != (turn == 0 ? "B" : "W")
        || line.at("moveInfos").empty() || (ownership && line.at("ownership").size() != size * size)) {
        throw std::runtime_error("Invalid KataGo result: " + line.dump());
      }
      remainingTurns.erase(remaining);
    }
    responses.lines.clear();
  };
  query("review", {0, 1}, false);
  query("coach", {1}, true);
  engine.reset();
  std::cout << "KataGo review and Coach passed on " << size << "x" << size << '\n';
}

int main(int argc, char** argv) {
  if (argc != 3) return 2;
  try {
    for (int size : {9, 13, 19}) checkBoard(argv[1], argv[2], size);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
